/* ============================================================================
   EL TANICHI · TERMINAL DE MERCADO PAGO (Point)
   Todo lo que habla con la API real de Mercado Pago pasa por el servidor
   local (endpoints /__mp/...): el token nunca llega al navegador ni al
   Artifact, vive sólo en el archivo mp-credenciales.json de esta computadora.
   Sin el servidor local (por ejemplo, viendo el Artifact publicado) estas
   funciones simplemente no tienen con quién hablar y avisan que hace falta.
   ========================================================================== */

let MP_TERMINALES = [];

/** Hay una terminal conectada y en modo punto de venta: el cobro con tarjeta puede ir por ella. */
function mpTerminalListo() { return MP_TERMINALES.some(d => d.operating_mode === 'PDV'); }

async function llamarMP(ruta, opciones = {}) {
  const r = await fetch(ruta, { cache: 'no-store', ...opciones });
  let datos;
  try { datos = await r.json(); } catch { datos = null; }
  if (!r.ok || (datos && datos.error)) {
    throw new Error((datos && datos.error) || `No se pudo conectar (código ${r.status}).`);
  }
  return datos;
}

/* --------------------------------------------------------------- Ajustes */
async function renderEstadoMP() {
  const cont = document.getElementById('mp-estado');
  if (!cont) return;
  cont.textContent = 'Revisando…';
  try {
    const est = await llamarMP('__mp/estado');
    if (est.configurado) {
      cont.innerHTML = `<span class="bueno">✓ Conectado.</span> Se guardó tu Access Token en esta computadora.`;
      setVal('mp-store', est.storeId || '');
      setVal('mp-pos', est.posId || '');
    } else {
      cont.innerHTML = 'Todavía no has conectado tu terminal.';
    }
  } catch (e) {
    // Sin servidor local (por ejemplo, viendo el Artifact) no hay con quién
    // hablar: no es un error de Mercado Pago, es que esto necesita la app
    // corriendo con servidor-tanichi.ps1.
    cont.innerHTML = 'Esto sólo funciona abriendo la app con el servidor local (TANICHI.bat), no en el enlace publicado.';
  }
}

async function guardarCredencialesMP() {
  const accessToken = (document.getElementById('mp-token')?.value || '').trim();
  const storeId = (document.getElementById('mp-store')?.value || '').trim();
  const posId   = (document.getElementById('mp-pos')?.value || '').trim();
  if (!accessToken) { toast('Escribe tu Access Token.', 'error'); return; }

  try {
    await llamarMP('__mp/guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, storeId, posId }),
    });
    setVal('mp-token', '');
    toast('Credenciales guardadas en esta computadora.', 'success');
    await renderEstadoMP();
    await probarConexionMP();
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, 'error');
  }
}

async function probarConexionMP() {
  const cont = document.getElementById('mp-terminales');
  if (!cont) return;
  cont.textContent = 'Buscando tu terminal…';
  try {
    const r = await llamarMP('__mp/terminales');
    MP_TERMINALES = r.devices || [];
    if (!MP_TERMINALES.length) {
      cont.innerHTML = 'Se conectó, pero no aparece ninguna terminal. Revisa que esté encendida y en modo PDV.';
      return;
    }
    cont.innerHTML = `<strong>${MP_TERMINALES.length} terminal(es) encontrada(s):</strong>` +
      MP_TERMINALES.map(d => {
        const pdv = d.operating_mode === 'PDV';
        return `<div style="margin-top:8px">${esc(d.external_pos_id || d.id)} — ` +
          (pdv ? '<span class="bueno">✓ lista para recibir cobros de la app</span>'
               : '<span class="malo">en modo independiente: todavía no recibe cobros de la app</span>' +
                 `<br><button class="btn btn-primary compacto" style="margin-top:6px" onclick="activarModoPdvMP('${esc(d.id)}')">Activar modo punto de venta</button>` +
                 '<br><span class="hint">Después hay que reiniciar la terminal (apagarla y prenderla). Mientras esté en este modo no cobra por su cuenta.</span>') +
          '</div>';
      }).join('');
  } catch (e) {
    cont.innerHTML = `<span class="malo">${esc(e.message)}</span>`;
  }
}

async function activarModoPdvMP(terminalId) {
  const ok = await confirmar({
    titulo: 'Activar modo punto de venta',
    mensaje: 'La terminal dejará de cobrar por su cuenta y sólo recibirá los cobros que mande esta app. Mercado Pago pide reiniciarla (apagar y prender) para que el cambio surta efecto. ¿Continuar?',
    ok: 'Sí, activar',
  });
  if (!ok) return;
  try {
    await llamarMP('__mp/modo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ terminalId, modo: 'PDV' }) });
    toast('Listo. Ahora apaga y vuelve a prender la terminal.', 'success', 8000);
    await probarConexionMP();
  } catch (e) {
    toast('No se pudo cambiar el modo: ' + e.message, 'error', 9000);
  }
}

/* ------------------------------------------------ cobro desde el punto de
   venta: crea la orden en la terminal y pregunta cada pocos segundos si ya
   se cobró —no hay webhook posible sin un servidor público—.            */
let MP_COBRO_ACTIVO = null;   // { ordenId, detener }

async function cobrarConTerminalMP(monto) {
  if (MP_TERMINALES.length === 0) {
    try { await probarConexionMPSilencioso(); } catch { /* se avisa abajo */ }
  }
  if (MP_TERMINALES.length === 0) {
    toast('No hay ninguna terminal conectada. Ve a Ajustes → Terminal de Mercado Pago.', 'error', 7000);
    return null;
  }
  const terminal = MP_TERMINALES.find(d => d.operating_mode === 'PDV') || MP_TERMINALES[0];
  if (terminal.operating_mode !== 'PDV') {
    toast('La terminal está en modo independiente y no recibe cobros de la app. Ve a Ajustes → Terminal de Mercado Pago y pulsa "Activar modo punto de venta".', 'error', 10000);
    return null;
  }

  let orden;
  try {
    orden = await llamarMP('__mp/cobrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto, terminalId: terminal.id }),
    });
  } catch (e) {
    toast('No se pudo mandar el cobro a la terminal: ' + e.message, 'error', 7000);
    return null;
  }

  return new Promise((resolve) => {
    mostrarEsperaMP(monto);
    let detenido = false;
    const cancelar = async () => {
      detenido = true;
      ocultarEsperaMP();
      try { await llamarMP('__mp/cancelar?id=' + encodeURIComponent(orden.id), { method: 'POST' }); } catch { /* ya de perdida se intentó */ }
      resolve(null);
    };
    MP_COBRO_ACTIVO = { ordenId: orden.id, detener: cancelar };

    const empezo = Date.now();
    let erroresSeguidos = 0;
    const revisar = async () => {
      if (detenido) return;
      let estado, error = null;
      try {
        estado = await llamarMP('__mp/orden?id=' + encodeURIComponent(orden.id));
        erroresSeguidos = 0;
      } catch (e) {
        estado = null;
        error = e.message;
        erroresSeguidos++;
      }

      // Dos fallos seguidos: no es un bache de red, es algo que no se va a
      // arreglar esperando —mejor avisar ya que agotar los 3 minutos en vano—.
      if (erroresSeguidos >= 2) {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('No se pudo consultar el cobro: ' + error, 'error', 9000);
        resolve(null);
        return;
      }

      setText('espera-mp-estado', estado
        ? `Mercado Pago dice: ${estado.status}${estado.status_detail ? ' (' + estado.status_detail + ')' : ''}`
        : (error ? `Reintentando… (${error})` : ''));

      const status = estado && estado.status;
      if (status === 'processed') {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('Cobro confirmado en la terminal.', 'success');
        resolve(estado);
        return;
      }
      if (status === 'action_required') {
        // Mercado Pago avisa que este estatus ya no cambia solo: hay que
        // ver la pantalla de la terminal para saber si de verdad se cobró.
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('Mercado Pago no puede confirmar sola. Revisa la pantalla de la terminal.', 'warn', 8000);
        resolve('accion_requerida');
        return;
      }
      if (status === 'failed') {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('La terminal marcó el cobro como fallido. Intenta de nuevo.', 'error', 7000);
        resolve(null);
        return;
      }
      if (status === 'canceled' || status === 'expired') {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('El cobro no se completó en la terminal.', 'warn', 6000);
        resolve(null);
        return;
      }
      // "created" / "at_terminal": sigue esperando, hasta 3 minutos
      if (Date.now() - empezo > 3 * 60 * 1000) {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('Se agotó el tiempo de espera. Revisa la terminal.', 'warn', 7000);
        resolve(null);
        return;
      }
      setTimeout(revisar, 3000);
    };
    setTimeout(revisar, 2000);
  });
}

async function probarConexionMPSilencioso() {
  const r = await llamarMP('__mp/terminales');
  MP_TERMINALES = r.devices || [];
}

/** Botón "Cobrar $X en la terminal" dentro del modal de cobro del POS. */
async function iniciarCobroTerminalMP() {
  const c = POS.cobro;
  const tar = c && c.pagos.find(p => p.metodo === 'tarjeta');
  if (!tar || num(tar.monto) <= 0) return;

  const btn = document.getElementById('btn-cobrar-terminal-mp');
  if (btn) btn.disabled = true;
  tar.requiereConfirmacionManual = false;
  const resultado = await cobrarConTerminalMP(num(tar.monto));
  if (resultado === 'accion_requerida') {
    tar.requiereConfirmacionManual = true;
  } else if (resultado) {
    tar.confirmadoTerminal = true;
  }
  if (btn) btn.disabled = !!(tar && tar.confirmadoTerminal);
  renderCobro();
  // Aprobado en la terminal = venta registrada, sin otro paso
  if (tar.confirmadoTerminal && POS.cobro === c) confirmarCobro();
}

/** Botón "Ya se cobró en la terminal": para cuando Mercado Pago avisa que
    ya no puede confirmar sola (estatus action_required) y hay que fiarse
    de lo que la pantalla de la terminal muestra. */
function confirmarCobroTerminalManual() {
  const c = POS.cobro;
  const tar = c && c.pagos.find(p => p.metodo === 'tarjeta');
  if (!tar) return;
  tar.confirmadoTerminal = true;
  tar.requiereConfirmacionManual = false;
  renderCobro();
  confirmarCobro();
}

function mostrarEsperaMP(monto) {
  const modal = document.getElementById('modal-espera-mp');
  if (!modal) return;
  setText('espera-mp-monto', fmt(monto));
  setText('espera-mp-estado', '');
  abrirModal('modal-espera-mp');
}
function ocultarEsperaMP() {
  cerrarModal('modal-espera-mp');
}
function cancelarEsperaMP() {
  if (MP_COBRO_ACTIVO) MP_COBRO_ACTIVO.detener();
}


/** Botón de Corte de caja → Saldos: compara contra lo que de verdad pasó
    en Mercado Pago el día del turno, en vez de fiarse sólo de la memoria. */

/* ------------------------------------------------- reporte de cuenta
   Retiros, liquidaciones y demás: Mercado Pago arma este reporte de fondo
   —no es instantáneo como buscar pagos—, así que hay que pedirlo y
   preguntar cada rato si ya está listo, hasta descargarlo.            */
let MP_REPORTE_PEDIDO = 0;   // cuándo (hora de esta computadora) se pidió el último reporte

async function traerReporteMP(desdeISO, hastaISO, { maxMin = 6 } = {}) {
  // Las fechas que devuelve Mercado Pago no son confiables para comparar, así
  // que se reconoce "el reporte que acabo de pedir" por su número: es el
  // primero listo que no estaba en la lista de antes.
  let previos = new Set();
  try {
    const previo = await llamarMP('__mp/reporte/estado');
    previos = new Set((previo.results || []).map(x => x.id));
  } catch { /* si falla, el intento de abajo avisa */ }

  // Si ya se pidió uno hace poco y sigue armándose, se espera ése: pedir otro
  // encima sólo alarga la fila de Mercado Pago.
  const yaPedido = Date.now() - MP_REPORTE_PEDIDO < 15 * 60 * 1000;
  if (!yaPedido) {
    try {
      await llamarMP('__mp/reporte/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desde: desdeISO, hasta: hastaISO }),
      });
      MP_REPORTE_PEDIDO = Date.now();
    } catch (e) {
      throw new Error('Al pedir el reporte: ' + e.message);
    }
  }

  const empezo = Date.now();
  while (Date.now() - empezo < maxMin * 60 * 1000) {
    await new Promise(r => setTimeout(r, 5000));
    let estado;
    try {
      estado = await llamarMP('__mp/reporte/estado');
    } catch (e) {
      throw new Error('Al consultar el estado del reporte: ' + e.message);
    }
    const rep = (estado.results || []).find(x =>
      (x.status === 'enabled' || x.status === 'processed') && x.file_name && !previos.has(x.id));
    if (rep) {
      try {
        const descarga = await llamarMP('__mp/reporte/descargar?archivo=' + encodeURIComponent(rep.file_name));
        MP_REPORTE_PEDIDO = 0;
        return descarga.movimientos || [];
      } catch (e) {
        throw new Error('Al descargar el reporte: ' + e.message);
      }
    }
  }
  throw new Error('Mercado Pago sigue armando el reporte. Se vuelve a intentar al volver a abrir el corte.');
}

/** Columnas del reporte de liberaciones (release_report); su nombre puede
    variar mayúsculas/minúsculas. BALANCE_AMOUNT es oro: es el saldo real
    de la cuenta justo después de ese movimiento, tal como Mercado Pago lo
    calcula —no hace falta sumar nada nosotros para saber el cierre—. */
function fechaMovimientoMP(fila) { return fila.DATE || fila.date || ''; }
function categoriaMovimientoMP(fila) { return fila.DESCRIPTION || fila.description || ''; }
function montoMovimientoMP(fila) { return num(fila.GROSS_AMOUNT ?? fila.gross_amount); }
function saldoTrasMovimientoMP(fila) { return num(fila.BALANCE_AMOUNT ?? fila.balance_amount); }

/* Cómo se llama cada movimiento en la cuenta. "Pagos hechos desde Mercado
   Pago" incluye la compra de tiempo aire de las recargas. */
function clasificarMovimientoMP(f) {
  const d = categoriaMovimientoMP(f);
  const m = montoMovimientoMP(f);
  const tipo = String(f.PAYMENT_METHOD_TYPE || f.payment_method_type || '');
  if (!d || d.startsWith('reserve_for_')) return null;   // aparta y libera: se cancela solo
  if (d === 'payout') return { clave: 'retiro', txt: 'Retiros' };
  if (d === 'payment') {
    if (m < 0) return { clave: 'pago', txt: 'Pagos hechos desde Mercado Pago (recargas, servicios…)' };
    if (/card/.test(tipo)) return { clave: 'tarjeta', txt: 'Cobros con tarjeta (terminal)' };
    if (/transfer/.test(tipo)) return { clave: 'transf', txt: 'Transferencias recibidas' };
    return { clave: 'cobro', txt: 'Otros cobros recibidos' };
  }
  if (d === 'cashback') return { clave: 'cashback', txt: 'Cashback' };
  if (d === 'asset_management') return { clave: 'rend', txt: 'Rendimientos' };
  if (d === 'refund') return { clave: 'reembolso', txt: 'Reembolsos' };
  return { clave: d, txt: d.replace(/_/g, ' ') };
}

/* ------------------------------------------------ sincronización automática
   Al abrir el corte la app le pregunta sola a Mercado Pago: saldo real,
   retiros y movimientos del día. Esos campos pasan a ser sólo lectura; si
   Mercado Pago no está conectado o falla, se quedan para capturar a mano. */
let MP_SYNC = { enCurso: false, ultimoIntento: 0, error: '' };

function resumirReporteMP(filas, fecha) {
  const conFecha = filas.filter(f => fechaMovimientoMP(f));
  const deHoyTodo = conFecha.filter(f => fechaMovimientoMP(f).slice(0, 10) === fecha);
  const ultima = (deHoyTodo.length ? deHoyTodo : conFecha).slice(-1)[0];
  const cierre = ultima ? redondear(saldoTrasMovimientoMP(ultima)) : null;
  const movs = [];
  const grupos = new Map();
  let retiros = 0;
  deHoyTodo.forEach(f => {
    const c = clasificarMovimientoMP(f);
    if (!c) return;
    const monto = montoMovimientoMP(f);
    movs.push({ hora: fechaMovimientoMP(f).slice(11, 16), txt: c.txt, monto });
    const g = grupos.get(c.clave) || { txt: c.txt, total: 0, n: 0 };
    g.total = redondear(g.total + monto); g.n++;
    grupos.set(c.clave, g);
    if (c.clave === 'retiro') retiros = redondear(retiros + Math.abs(monto));
  });
  return { cierre, retiros, movs, grupos: [...grupos.values()] };
}

async function sincronizarMP({ forzar = false } = {}) {
  if (!TURNO.abierto || TURNO.modoEdicion || MP_SYNC.enCurso) return;
  const ahora = Date.now();
  const fresco = TURNO.mpSync && ahora - TURNO.mpSync.ts < 3 * 60 * 1000;
  if (!forzar && (fresco || ahora - MP_SYNC.ultimoIntento < 2 * 60 * 1000)) { pintarSyncMP(); return; }
  MP_SYNC.enCurso = true; MP_SYNC.ultimoIntento = ahora; MP_SYNC.error = '';
  pintarSyncMP();
  try {
    const est = await llamarMP('__mp/estado');
    if (!est.configurado) { MP_SYNC.error = 'noconectado'; return; }
    const fecha = TURNO.fecha || hoyISO();
    const filas = await traerReporteMP(`${fecha}T00:00:00Z`, `${fecha}T23:59:59Z`);
    const r = resumirReporteMP(filas, fecha);
    if (r.cierre === null) { MP_SYNC.error = 'Mercado Pago no devolvió saldo.'; return; }
    TURNO.mpCierre = r.cierre;
    TURNO.mpRetiros = r.retiros;
    TURNO.mpSync = { ts: Date.now(), cierre: r.cierre, retiros: r.retiros, movs: r.movs, grupos: r.grupos };
    guardarTurno();
  } catch (e) {
    MP_SYNC.error = e.message;
  } finally {
    MP_SYNC.enCurso = false;
    renderPanelSaldos();
    actualizarBadgeCuadre();
    if (VISTA === 'corte' && TAB_CORTE === 'cuadre') renderCorte();
  }
}

/** Estado, campos bloqueados y lista de movimientos en la tarjeta de Saldos. */
function pintarSyncMP() {
  const box = document.getElementById('sal-mp-sync');
  const lista = document.getElementById('sal-mp-reporte');
  if (!box) return;
  const s = TURNO.mpSync;
  ['sal-mp-retiros', 'sal-mp-cierre'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.readOnly = !!s;
  });
  if (MP_SYNC.enCurso) {
    box.innerHTML = '<strong>Consultando Mercado Pago…</strong> tarda unos segundos.';
  } else if (s) {
    const hora = new Date(s.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    box.innerHTML = `<strong>✓ Sincronizado con Mercado Pago a las ${hora}.</strong> El saldo y los retiros vienen de tu cuenta: no hay que capturarlos.` +
      (MP_SYNC.error && MP_SYNC.error !== 'noconectado' ? `<br><span class="malo">La última actualización falló: ${esc(MP_SYNC.error)}</span>` : '');
  } else if (MP_SYNC.error === 'noconectado') {
    box.innerHTML = 'Mercado Pago no está conectado: captura el saldo y los retiros a mano, o conéctalo en Ajustes.';
  } else if (MP_SYNC.error) {
    box.innerHTML = `<span class="malo">No se pudo consultar Mercado Pago: ${esc(MP_SYNC.error)}</span><br>Captura el saldo a mano o intenta de nuevo.`;
  } else {
    box.innerHTML = 'Todavía no se consulta Mercado Pago.';
  }
  if (!lista) return;
  if (!s) { lista.innerHTML = ''; return; }
  const signo = (v) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v));
  const filasGrupo = s.grupos.map(g =>
    `<li>${esc(g.txt)}${g.n > 1 ? ` (${g.n})` : ''}: <strong class="${g.total >= 0 ? 'bueno' : 'malo'}">${signo(g.total)}</strong></li>`).join('');
  const filasMov = s.movs.map(m =>
    `<tr><td>${esc(m.hora)}</td><td>${esc(m.txt)}</td><td class="der mono ${m.monto >= 0 ? 'bueno' : 'malo'}">${signo(m.monto)}</td></tr>`).join('');
  lista.innerHTML = (filasGrupo ? `<ul class="lista-dif">${filasGrupo}</ul>` : '<p class="hint">Sin movimientos de hoy en la cuenta.</p>') +
    (filasMov ? `<details style="margin-top:8px"><summary class="link">Ver los ${s.movs.length} movimientos del día</summary>
      <div class="tabla-scroll" style="max-height:260px;margin-top:8px"><table class="tabla"><tbody>${filasMov}</tbody></table></div></details>` : '');
}

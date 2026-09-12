/* ============================================================================
   EL TANICHI · TERMINAL DE MERCADO PAGO (Point)
   Todo lo que habla con la API real de Mercado Pago pasa por el servidor
   local (endpoints /__mp/...): el token nunca llega al navegador ni al
   Artifact, vive sólo en el archivo mp-credenciales.json de esta computadora.
   Sin el servidor local (por ejemplo, viendo el Artifact publicado) estas
   funciones simplemente no tienen con quién hablar y avisan que hace falta.
   ========================================================================== */

let MP_TERMINALES = [];

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
    cont.innerHTML = `<strong>${MP_TERMINALES.length} terminal(es) encontrada(s):</strong><br>` +
      MP_TERMINALES.map(d => esc(d.external_pos_id || d.id)).join(', ');
  } catch (e) {
    cont.innerHTML = `<span class="malo">${esc(e.message)}</span>`;
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
  const terminal = MP_TERMINALES[0];   // si hay varias, se cobra en la primera

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
    const revisar = async () => {
      if (detenido) return;
      let estado;
      try { estado = await llamarMP('__mp/orden?id=' + encodeURIComponent(orden.id)); }
      catch (e) { estado = null; }

      const status = estado && estado.status;
      if (status === 'processed') {
        ocultarEsperaMP();
        MP_COBRO_ACTIVO = null;
        toast('Cobro confirmado en la terminal.', 'success');
        resolve(estado);
        return;
      }
      if (status === 'cancelled' || status === 'expired') {
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
  const resultado = await cobrarConTerminalMP(num(tar.monto));
  if (resultado) tar.confirmadoTerminal = true;
  if (btn) btn.disabled = !!(tar && tar.confirmadoTerminal);
  renderCobro();
}

function mostrarEsperaMP(monto) {
  const modal = document.getElementById('modal-espera-mp');
  if (!modal) return;
  setText('espera-mp-monto', fmt(monto));
  abrirModal('modal-espera-mp');
}
function ocultarEsperaMP() {
  cerrarModal('modal-espera-mp');
}
function cancelarEsperaMP() {
  if (MP_COBRO_ACTIVO) MP_COBRO_ACTIVO.detener();
}

/* --------------------------------------------------- movimientos reales
   Para comparar contra lo que el corte calculó, en vez de escribirlo a
   mano. Se usa desde Corte de caja → Saldos.                            */
async function consultarMovimientosMP(desdeISO, hastaISO) {
  const q = `__mp/movimientos?desde=${encodeURIComponent(desdeISO)}&hasta=${encodeURIComponent(hastaISO)}`;
  const r = await llamarMP(q);
  return (r.results || []).map(p => ({
    id: p.id, fecha: p.date_created, estado: p.status,
    monto: num(p.transaction_amount), descripcion: p.description || '',
  }));
}

/** Botón de Corte de caja → Saldos: compara contra lo que de verdad pasó
    en Mercado Pago el día del turno, en vez de fiarse sólo de la memoria. */
async function consultarMovimientosMPSaldos() {
  const cont = document.getElementById('sal-mp-movimientos');
  if (!cont) return;
  cont.textContent = 'Consultando…';
  const fecha = TURNO.fecha || hoyISO();
  try {
    const movs = await consultarMovimientosMP(fecha, fecha);
    if (!movs.length) {
      cont.textContent = `Mercado Pago no tiene cobros el ${fecha}.`;
      return;
    }
    const aprobados = movs.filter(m => m.estado === 'approved');
    const total = redondear(aprobados.reduce((s, m) => s + m.monto, 0));
    cont.innerHTML = `<strong>${aprobados.length} cobro(s) aprobado(s) el ${fecha}: ${fmt(total)}.</strong>` +
      '<ul class="lista-dif">' + aprobados.slice(0, 8).map(m =>
        `<li>${esc(horaDe(m.fecha))} — ${fmt(m.monto)}${m.descripcion ? ' · ' + esc(m.descripcion) : ''}</li>`).join('') +
      (aprobados.length > 8 ? `<li>y ${aprobados.length - 8} más…</li>` : '') + '</ul>';
  } catch (e) {
    cont.innerHTML = `<span class="malo">${esc(e.message)}</span>`;
  }
}

/* ------------------------------------------------- reporte de cuenta
   Retiros, liquidaciones y demás: Mercado Pago arma este reporte de fondo
   —no es instantáneo como buscar pagos—, así que hay que pedirlo y
   preguntar cada rato si ya está listo, hasta descargarlo.            */
async function traerReporteMP(desdeISO, hastaISO) {
  const creado = await llamarMP('__mp/reporte/crear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desde: desdeISO, hasta: hastaISO }),
  });
  const id = creado.report_id || creado.id;
  if (!id) throw new Error('Mercado Pago no devolvió un identificador de reporte.');

  const empezo = Date.now();
  while (Date.now() - empezo < 2 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 4000));
    const estado = await llamarMP('__mp/reporte/estado?id=' + encodeURIComponent(id));
    const rep = (estado.results || [])[0];
    if (rep && rep.status === 'processed' && rep.file_name) {
      const descarga = await llamarMP('__mp/reporte/descargar?archivo=' + encodeURIComponent(rep.file_name));
      return descarga.movimientos || [];
    }
  }
  throw new Error('El reporte de Mercado Pago tardó demasiado. Intenta otra vez en un momento.');
}

/** Un renglón del reporte trae muchas columnas; estas dos son las únicas
    que hacen falta, y su nombre puede variar mayúsculas/minúsculas. */
function tipoMovimientoMP(fila) { return fila.TRANSACTION_TYPE || fila.transaction_type || '?'; }
function montoMovimientoMP(fila) {
  const v = fila.SETTLEMENT_NET_AMOUNT ?? fila.settlement_net_amount ?? fila.TRANSACTION_AMOUNT ?? fila.transaction_amount;
  return Math.abs(num(v));
}

const NOMBRES_MOVIMIENTO_MP = {
  SETTLEMENT: 'Cobros', REFUND: 'Reembolsos', CHARGEBACK: 'Contracargos',
  DISPUTE: 'Disputas', WITHDRAWAL: 'Retiros', WITHDRAWAL_CANCEL: 'Retiros cancelados', PAYOUT: 'Retiros',
};

/** Botón de Corte de caja → Saldos: trae TODOS los movimientos reales del
    día —incluidos los retiros—, para no tener que anotarlos a mano. */
async function consultarReporteMPSaldos() {
  const cont = document.getElementById('sal-mp-reporte');
  if (!cont) return;
  cont.textContent = 'Generando tu reporte de Mercado Pago… puede tardar un minuto.';
  try {
    const fecha = TURNO.fecha || hoyISO();
    const filas = await traerReporteMP(`${fecha}T00:00:00Z`, `${fecha}T23:59:59Z`);
    if (!filas.length) {
      cont.textContent = `Mercado Pago no registra movimientos de cuenta el ${fecha}.`;
      return;
    }
    const grupos = new Map();
    filas.forEach(f => {
      const t = tipoMovimientoMP(f);
      grupos.set(t, redondear((grupos.get(t) || 0) + montoMovimientoMP(f)));
    });
    const retiros = redondear((grupos.get('WITHDRAWAL') || 0) + (grupos.get('PAYOUT') || 0));

    cont.innerHTML = '<ul class="lista-dif">' + [...grupos.entries()].map(([t, v]) =>
      `<li>${esc(NOMBRES_MOVIMIENTO_MP[t] || t)}: ${fmt(v)}</li>`).join('') + '</ul>' +
      (retiros ? `<button class="link" onclick="usarRetiroDetectadoMP(${retiros})">Usar ${fmt(retiros)} como "Retiros o pagos hechos desde MP"</button>` : '');
  } catch (e) {
    cont.innerHTML = `<span class="malo">${esc(e.message)}</span>`;
  }
}

function usarRetiroDetectadoMP(monto) {
  TURNO.mpRetiros = monto;
  setVal('sal-mp-retiros', monto);
  guardarTurno();
  renderPanelSaldos();
  actualizarBadgeCuadre();
  toast('Retiros actualizados desde Mercado Pago.', 'success');
}

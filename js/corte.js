/* ============================================================================
   TANICHI · CORTE DE CAJA
   Apertura, conteo por denominación, ingresos (POS + captura manual),
   egresos, conciliación de Caja / Mercado Pago / Cartera y reporte final.
   ========================================================================== */

let TAB_CORTE = 'efectivo';

/* ========================================================== APERTURA ==== */
function renderApertura() {
  /* datos del turno */
  // Mientras nadie haya elegido a mano, el turno sigue a la hora del día: si
  // dejaste la app abierta desde la mañana, al volver en la noche ya trae el
  // que toca. En cuanto eliges uno, se respeta tu elección.
  const sugerido = turnoDeLaHora();
  if (!TURNO.abierto && TURNO.horarioAuto !== false && sugerido) {
    TURNO.horario = sugerido.horario;
    TURNO.cajero  = sugerido.cajero || TURNO.cajero;
    guardarTurno();
  }
  llenarListaApertura('ap-cajero', CONFIG.cajeros || [], TURNO.cajero, sugerido && sugerido.cajero);
  llenarListaApertura('ap-horario', (CONFIG.turnos || []).map(t => t.horario), TURNO.horario,
                      sugerido && sugerido.horario);
  setVal('ap-fecha', TURNO.fecha || hoyISO());
  setVal('ap-notas', TURNO.notas || '');
  setVal('ap-mp-inicial', TURNO.mpInicial || '');
  setVal('ap-cartera-inicial', TURNO.carteraInicial || '');
  show('ap-tc-wrap', CONFIG.tarjetaCreditoActiva, 'flex');
  if (CONFIG.tarjetaCreditoActiva) {
    setText('ap-tc-lbl', `Debías en ${CUENTAS.tc.largo.toLowerCase()} al abrir`);
    setVal('ap-tc-inicial', TURNO.tcInicial || '');
  }

  construirTablaDenominaciones('apertura');
  aplicarModoConteo('apertura');
  actualizarConteo('apertura');
  renderSugerenciaTurno();

  // Con el turno ya abierto, esta pantalla sirve para corregir el fondo
  show('ap-banner-abierto', TURNO.abierto, 'flex');
  const btn = document.getElementById('btn-abrir-turno');
  if (btn) btn.innerHTML = TURNO.abierto
    ? `${icono('palomita')}Guardar el fondo corregido y volver al punto de venta`
    : `${icono('candado')}Abrir turno y empezar a vender`;
}

/* --------------------------------------------- listas de la apertura ---- */

const OTRO = '__otro__';

/**
 * Llena un desplegable con lo configurado en Ajustes. Si el turno traía un
 * valor que ya no está en la lista, no se pierde: se agrega como opción.
 */
function llenarListaApertura(id, opciones, valor, sugerido) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const lista = [...new Set(opciones.filter(Boolean))];
  if (valor && !lista.includes(valor)) lista.push(valor);

  sel.innerHTML =
    (lista.length ? '' : `<option value="">— nada configurado en Ajustes —</option>`) +
    lista.map(o => `<option value="${esc(o)}"${o === valor ? ' selected' : ''}>${esc(o)}${
      o === sugerido ? ' · el de esta hora' : ''}</option>`).join('') +
    `<option value="${OTRO}">Otro…</option>`;

  // Sin coincidencia, el navegador dejaría marcada la primera: mejor explícito
  sel.value = lista.includes(valor) ? valor : (lista[0] || '');
  const otro = document.getElementById(id + '-otro');
  if (otro) otro.style.display = 'none';
}

/** Cambia entre elegir de la lista y escribir uno nuevo. */
function alternarOtro(id, valor, aplicar) {
  const otro = document.getElementById(id + '-otro');
  if (valor === OTRO) {
    if (otro) { otro.style.display = 'block'; otro.value = ''; otro.focus(); }
    aplicar('');
  } else {
    if (otro) otro.style.display = 'none';
    aplicar(valor);
  }
  guardarTurno();
}

/* Elegir a mano congela el valor: ya no lo mueve el reloj. */
function elegirCajero(v)  { alternarOtro('ap-cajero',  v, x => { TURNO.cajero  = x; TURNO.horarioAuto = false; }); }
function elegirHorario(v) { alternarOtro('ap-horario', v, x => { TURNO.horario = x; TURNO.horarioAuto = false; }); }

/* ------------------------------------------------ turno según la hora ----
   rangoHorario() y turnoDeLaHora() viven en turno.js: los usa también
   turnoVacio(), que corre antes de que esta pantalla exista.              */

/** Aviso sólo cuando lo puesto no coincide con lo que toca por la hora. */
function renderSugerenciaTurno() {
  const el = document.getElementById('ap-sugerencia');
  if (!el) return;
  const s = turnoDeLaHora();
  if (!s || TURNO.abierto || (TURNO.horario === s.horario && TURNO.cajero === s.cajero)) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = `<span>${icono('reloj')}</span><div>Por la hora te toca <strong>${esc(s.horario)}</strong>
    (${esc(s.cajero)}).
    <button class="link" data-horario="${esc(s.horario)}" data-cajero="${esc(s.cajero)}"
            onclick="usarTurnoSugerido(this.dataset.horario, this.dataset.cajero)">Usar ese turno</button></div>`;
}

function usarTurnoSugerido(horario, cajero) {
  TURNO.horario = horario; TURNO.cajero = cajero;
  guardarTurno();
  renderApertura();
  toast('Turno y responsable aplicados.', 'success', 2200);
}

/* ============================================== TABLAS DE DENOMINACIONES */
function construirTablaDenominaciones(ctx) {
  const tbody = document.getElementById(`denom-${ctx}`);
  if (!tbody) return;
  const piezas = ctx === 'apertura' ? TURNO.piezasApertura : TURNO.piezasCierre;

  tbody.innerHTML = DENOMINACIONES.map(d => `
    <tr class="fila-${d.tipo}">
      <td class="denom-lbl"><span class="punto ${d.tipo}"></span>${d.label}</td>
      <td>
        <div class="denom-campos">
          <input type="text" inputmode="decimal" class="input-denom js-calc" id="pz-${ctx}-${d.valor}"
                 value="${piezas[d.valor] || ''}" placeholder="0" aria-label="Piezas de ${d.label}"
                 oninput="onPiezas('${ctx}', ${d.valor}, this.value)"
                 onkeydown="onDenomEnter(event, '${ctx}', ${d.valor})"/>
          <span class="denom-x">piezas</span>
          <input type="text" inputmode="decimal" class="input-denom monto js-calc" id="mt-${ctx}-${d.valor}"
                 value="${piezas[d.valor] ? redondear(piezas[d.valor] * d.valor) : ''}" placeholder="$"
                 aria-label="Importe en ${d.label}"
                 oninput="onMonto('${ctx}', ${d.valor}, this.value)"
                 onkeydown="onDenomEnter(event, '${ctx}', ${d.valor})"/>
        </div>
      </td>
      <td class="mono der" id="tot-${ctx}-${d.valor}">${fmt((piezas[d.valor] || 0) * d.valor)}</td>
    </tr>`).join('');
}

function onPiezas(ctx, valor, txt) {
  const piezas = ctx === 'apertura' ? TURNO.piezasApertura : TURNO.piezasCierre;
  const q = Math.max(0, num(txt, 0));
  if (q) piezas[valor] = q; else delete piezas[valor];

  const mt = document.getElementById(`mt-${ctx}-${valor}`);
  if (mt && document.activeElement !== mt) mt.value = q ? redondear(q * valor) : '';
  setText(`tot-${ctx}-${valor}`, fmt(q * valor));
  actualizarConteo(ctx);
}

/** Permite capturar por importe: "$340 en billetes de 20" calcula las piezas. */
function onMonto(ctx, valor, txt) {
  const piezas = ctx === 'apertura' ? TURNO.piezasApertura : TURNO.piezasCierre;
  const monto = Math.max(0, num(txt, 0));
  const q = monto ? redondear(monto / valor, 4) : 0;
  if (q) piezas[valor] = q; else delete piezas[valor];

  const pz = document.getElementById(`pz-${ctx}-${valor}`);
  if (pz && document.activeElement !== pz) pz.value = q || '';
  setText(`tot-${ctx}-${valor}`, fmt(q * valor));
  actualizarConteo(ctx);
}

function onDenomEnter(ev, ctx, valor) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  aplicarFormula(ev.target);
  const i = DENOMINACIONES.findIndex(d => d.valor === valor);
  const sig = DENOMINACIONES[i + 1];
  const destino = sig ? document.getElementById(`pz-${ctx}-${sig.valor}`) : null;
  if (destino) { destino.focus(); destino.select(); }
  else ev.target.blur();
}

function actualizarConteo(ctx) {
  const piezas = ctx === 'apertura' ? TURNO.piezasApertura : TURNO.piezasCierre;
  const totalConteo = totalPiezas(piezas);
  const modo  = ctx === 'apertura' ? TURNO.aperturaModo : TURNO.cierreModo;
  const total = modo === 'rapido'
    ? redondear(ctx === 'apertura' ? TURNO.fondoRapido : TURNO.cierreRapido)
    : totalConteo;

  setText(`total-${ctx}`, fmt(total));
  const nPz = DENOMINACIONES.reduce((s, d) => s + num(piezas[d.valor]), 0);
  setText(`piezas-${ctx}`, modo === 'rapido' ? 'captura rápida' : `${fmtNum(nPz, nPz % 1 ? 2 : 0)} piezas contadas`);

  if (ctx === 'apertura') TURNO.fondoApertura = total;
  guardarTurno();
  if (ctx === 'cierre') renderCuadre();
}

function cambiarModoConteo(ctx, modo) {
  if (ctx === 'apertura') TURNO.aperturaModo = modo; else TURNO.cierreModo = modo;
  aplicarModoConteo(ctx);
  actualizarConteo(ctx);
}

function aplicarModoConteo(ctx) {
  const modo = ctx === 'apertura' ? TURNO.aperturaModo : TURNO.cierreModo;
  show(`tabla-${ctx}`, modo !== 'rapido', 'block');
  show(`rapido-${ctx}`, modo === 'rapido', 'block');
  $$(`#modo-${ctx} .seg-btn`).forEach(b => b.classList.toggle('activo', b.dataset.modo === modo));
  const inp = document.getElementById(`rapido-${ctx}-input`);
  if (inp) inp.value = (ctx === 'apertura' ? TURNO.fondoRapido : TURNO.cierreRapido) || '';
}

function onRapido(ctx, txt) {
  const v = Math.max(0, num(txt, 0));
  if (ctx === 'apertura') TURNO.fondoRapido = v; else TURNO.cierreRapido = v;
  actualizarConteo(ctx);
}

/* ================================================== TABS DEL CORTE ===== */
function activarTabCorte(tab) {
  // Sin turno abierto sólo tiene sentido el reporte del corte que se consulta
  if (!TURNO.abierto) tab = 'reporte';
  TAB_CORTE = tab;
  $$('#corte-tabs .tab').forEach(b => b.classList.toggle('activo', b.dataset.tab === tab));
  $$('#vista-corte .panel-corte').forEach(p => p.classList.toggle('activo', p.id === `panel-${tab}`));
  renderCorte();
}

function renderCorte() {
  /* Modo consulta: se está viendo un corte ya cerrado */
  if (!TURNO.abierto) {
    TAB_CORTE = 'reporte';
    $$('#corte-tabs .tab').forEach(b => {
      const soloReporte = b.dataset.tab !== 'reporte';
      b.style.display = soloReporte ? 'none' : '';
      b.classList.toggle('activo', !soloReporte);
    });
    $$('#vista-corte .panel-corte').forEach(p => p.classList.toggle('activo', p.id === 'panel-reporte'));
    const c = CORTE_MOSTRADO;
    setText('corte-cajero', c?.cajero || '—');
    setText('corte-horario', c?.horario || c?.turno || '—');
    setText('corte-fecha', fechaCorta(c?.fecha));
    setText('corte-fondo', fmt(c?.fondoApertura));
    renderPanelReporte();
    return;
  }

  $$('#corte-tabs .tab').forEach(b => { b.style.display = ''; });

  switch (TAB_CORTE) {
    case 'efectivo':  renderPanelEfectivo();  break;
    case 'ingresos':  renderPanelIngresos();  break;
    case 'egresos':   renderPanelEgresos();   break;
    case 'saldos':    renderPanelSaldos();    break;
    case 'cuadre':    renderCuadre();         break;
    case 'reporte':   renderPanelReporte();   break;
  }
  setText('corte-cajero', TURNO.cajero || '—');
  setText('corte-horario', TURNO.horario || '—');
  setText('corte-fecha', fechaCorta(TURNO.fecha));
  setText('corte-fondo', fmt(fondoDeApertura()));
}

/* ------------------------------------------------------- panel: efectivo */
function renderPanelEfectivo() {
  construirTablaDenominaciones('cierre');
  aplicarModoConteo('cierre');
  actualizarConteo('cierre');

  const c = calcularCuadre();
  setText('efectivo-esperado', fmt(c.esperadoCaja));
  const dif = document.getElementById('efectivo-dif');
  if (dif) {
    dif.textContent = c.difCaja === 0 ? 'Cuadra exacto' : fmtDiff(c.difCaja);
    dif.className = 'dif-chip ' + (igualDinero(c.difCaja, 0) ? 'ok' : c.difCaja > 0 ? 'sobra' : 'falta');
  }
}

/* ------------------------------------------------------- panel: ingresos */
function renderPanelIngresos() {
  const pos = totalesPos();
  const m   = TURNO.manual;

  const filas = [
    { k: 'ventaEfectivo',   lbl: 'Ventas en efectivo',        ico: 'billete', pos: pos.efectivo,       ayuda: 'Lo que entró en billetes y monedas.' },
    { k: 'tarjeta',         lbl: 'Cobros con tarjeta',        ico: 'tarjeta', pos: pos.tarjeta,        ayuda: `La terminal descuenta ${fmtNum(CONFIG.comisionTerminalPct, 2)}% antes de depositar.` },
    { k: 'transferencia',   lbl: 'Transferencias / SPEI',     ico: 'telefono', pos: pos.transferencia + pos.abonosTransfer, ayuda: 'Depósitos recibidos en Mercado Pago.' },
    { k: 'pagoCreditos',    lbl: 'Cobro de fiados',           ico: 'personas', pos: pos.abonosEfectivo, ayuda: 'Abonos en efectivo de clientes con crédito.' },
    { k: 'creditoClientes', lbl: 'Vendido a crédito (fiado)', ico: 'lapiz', pos: pos.credito,        ayuda: 'No entró dinero: queda por cobrar.' },
  ];

  const cont = document.getElementById('ingresos-filas');
  if (cont) {
    cont.innerHTML = filas.map(f => {
      const manual = num(m[f.k]);
      const total  = redondear(f.pos + manual);
      return `
      <div class="ing-fila">
        <div class="ing-lbl"><span class="ing-ico">${icono(f.ico, 20)}</span>
          <div><strong>${f.lbl}</strong><span class="hint">${f.ayuda}</span></div>
        </div>
        <div class="ing-pos" title="Registrado automáticamente por el punto de venta">
          <span class="mini-lbl">Punto de venta</span>
          <span class="mono">${TURNO.modoEdicion ? '—' : fmt(f.pos)}</span>
        </div>
        <div class="ing-manual">
          <span class="mini-lbl">Captura manual</span>
          <input type="text" inputmode="decimal" class="input mono js-calc" value="${manual || ''}" placeholder="0.00"
                 oninput="onIngresoManual('${f.k}', this.value)" aria-label="${f.lbl} capturado a mano"/>
        </div>
        <div class="ing-total mono" id="ing-total-${f.k}">${fmt(total)}</div>
      </div>`;
    }).join('');
  }

  refrescarTotalesIngresos();

  const nota = document.getElementById('ingresos-nota');
  if (nota) nota.innerHTML = TURNO.modoEdicion
    ? `Estás <strong>corrigiendo un corte ya cerrado</strong>. Sus importes se pasaron a
       <strong>Captura manual</strong>: edítalos ahí. El punto de venta no vuelve a sumar
       para que nada se cuente dos veces.`
    : `La columna <strong>Punto de venta</strong> se llena sola con lo que cobraste en el POS.
       Usa <strong>Captura manual</strong> sólo para las ventas que no pasaron por ahí.`;

  renderOtrosIngresos();
  renderRecargasCorte();
}

/** Refresca sólo las cifras de la pestaña Ingresos.
 *  No reconstruye el DOM: si lo hiciera, el campo perdería el foco a cada tecla. */
function refrescarTotalesIngresos() {
  const pos  = totalesPos();
  const snap = snapshotTurno();

  const porFila = {
    ventaEfectivo:   snap.ventaEfectivo,
    tarjeta:         snap.tarjeta,
    transferencia:   snap.transferencia,
    pagoCreditos:    snap.pagoCreditos,
    creditoClientes: snap.creditoClientes,
  };
  Object.entries(porFila).forEach(([k, v]) => setText(`ing-total-${k}`, fmt(v)));

  /* comisión de la terminal, visible en el momento */
  const com = comisionTerminal(snap.tarjeta);
  show('caja-comision', snap.tarjeta > 0, 'grid');
  setText('com-bruto', fmt(snap.tarjeta));
  setText('com-pct', `− Comisión terminal (${fmtNum(CONFIG.comisionTerminalPct, 2)}%)`);
  setText('com-monto', '−' + fmt(com));
  setText('com-neto', fmt(snap.tarjeta - com));

  const totalIngresos = redondear(snap.ventaEfectivo + snap.tarjeta + snap.transferencia +
                                  snap.pagoCreditos + snap.otrosIngresos);
  setText('ingresos-total', fmt(totalIngresos));
  setText('ingresos-fiado', fmt(snap.creditoClientes));
  setText('ingresos-tickets', TURNO.modoEdicion ? 'corte corregido a mano'
    : `${fmtNum(pos.numVentas)} ventas · ${fmtNum(pos.piezas, pos.piezas % 1 ? 2 : 0)} artículos`);
}

function onIngresoManual(clave, valor) {
  TURNO.manual[clave] = Math.max(0, redondear(valor));
  guardarTurno();
  refrescarTotalesIngresos();
  if (clave === 'recargas') {
    const total = redondear(totalesPos().recargas + num(TURNO.manual.recargas));
    const com   = comisionPorRecargas(total);
    setText('rec-total', fmt(total));
    setText('rec-comision', fmt(com));
    setText('rec-neto', fmt(total - com));
  }
  actualizarBadgeCuadre();
}

function renderOtrosIngresos() {
  renderListaConceptos('otrosIngresos', 'lista-otros-ingresos', 'otros-ingresos', 'Sin otros ingresos registrados.');
  setText('otros-ingresos-total', fmt(sumaLista(TURNO.otrosIngresos)));
}

function renderRecargasCorte() {
  const pos   = totalesPos();
  const total = redondear(pos.recargas + num(TURNO.manual.recargas));
  const com   = comisionPorRecargas(total);
  setText('rec-total', fmt(total));
  setText('rec-comision', fmt(com));
  setText('rec-neto', fmt(total - com));
  setText('rec-num', TURNO.modoEdicion ? 'corte corregido' : `${fmtNum(pos.numRecargas)} recarga(s)`);
  setText('rec-regla', `Mercado Pago devuelve ${fmt(CONFIG.recargaMonto)} por cada ${fmt(CONFIG.recargaCada)} recargados.`);
  show('btn-recarga-corte', !TURNO.modoEdicion, 'inline-flex');

  const lista = document.getElementById('lista-recargas');
  if (!lista) return;

  if (TURNO.modoEdicion) {
    lista.innerHTML = `
      <label class="campo">
        <span class="campo-lbl">Total recargado en el turno</span>
        <input class="input mono js-calc" inputmode="decimal" value="${TURNO.manual.recargas || ''}" placeholder="0.00"
               oninput="onIngresoManual('recargas', this.value)"/>
        <span class="hint">Estás corrigiendo un corte cerrado: captura aquí el total de recargas.</span>
      </label>`;
    return;
  }

  const recargas = ventasDelTurno().filter(v => v.tipo === 'recarga');
  lista.innerHTML = recargas.length
    ? recargas.map(v => `
        <div class="mini-fila">
          <span>${icono('telefono')} ${esc(v.items[0]?.nombre || 'Recarga')}</span>
          <span class="mono">${fmt(v.total)}</span>
          <button class="btn-icono peligro" title="Cancelar recarga" onclick="cancelarVenta('${v.id}')">✕</button>
        </div>`).join('')
    : `<p class="hint">Las recargas se registran desde el punto de venta con el botón <strong>Recarga</strong>.</p>`;
}

/* -------------------------------------------------------- panel: egresos */
const LISTAS_EGRESO = [
  { clave: 'proveedores', titulo: 'Pago a proveedores', ico: 'camion', sug: 'proveedores', ayuda: 'Coca-Cola, Sabritas, Bimbo…' },
  { clave: 'servicios',   titulo: 'Servicios',          ico: 'recibo', sug: 'servicios',   ayuda: 'Luz, agua, internet, gas…' },
  { clave: 'honorarios',  titulo: 'Honorarios y sueldos', ico: 'persona', sug: 'honorarios', ayuda: 'Pagos a personas.' },
  { clave: 'otrosEgresos', titulo: 'Otras salidas de efectivo', ico: 'subir', sug: 'otros-retiros', ayuda: 'Cualquier otro retiro de la caja.' },
];

function renderPanelEgresos() {
  LISTAS_EGRESO.forEach(l => {
    renderListaConceptos(l.clave, `lista-${l.clave}`, l.sug, 'Sin registros.');
    setText(`total-${l.clave}`, fmt(sumaLista(TURNO[l.clave])));
  });
  setText('egresos-total', fmt(totalEgresos()));
  setVal('corte-obs', TURNO.obs || '');
  actualizarBadgeCuadre();
}

/** Render genérico de una lista de conceptos con importe (ingresos o egresos). */
function renderListaConceptos(claveLista, domId, claveSug, textoVacio) {
  const cont = document.getElementById(domId);
  if (!cont) return;
  const lista = TURNO[claveLista] || [];

  if (!lista.length) {
    cont.innerHTML = `<p class="hint">${textoVacio}</p>`;
    return;
  }
  // Los ingresos no llevan cuenta de origen; los egresos, sí
  const conCuenta = claveLista !== 'otrosIngresos';

  cont.innerHTML = lista.map((item, i) => `
    <div class="concepto ${conCuenta ? 'con-cuenta' : ''}">
      <input type="text" class="input" list="dl-${claveSug}" value="${esc(item.desc || '')}" placeholder="Concepto"
             oninput="onConcepto('${claveLista}', ${i}, 'desc', this.value)"
             onchange="guardarSugerenciaConcepto('${claveSug}', this.value)" aria-label="Concepto"/>
      ${conCuenta ? `
      <select class="input compacto" aria-label="De qué cuenta sale"
              onchange="onConcepto('${claveLista}', ${i}, 'origen', this.value)">
        ${Object.entries(CUENTAS).map(([k, c]) =>
          `<option value="${k}"${k === cuentaDeEgreso(item) ? ' selected' : ''}>${c.label}</option>`).join('')}
      </select>` : ''}
      <input type="text" inputmode="decimal" class="input mono js-calc" value="${item.monto || ''}" placeholder="0.00"
             oninput="onConcepto('${claveLista}', ${i}, 'monto', this.value)" aria-label="Importe"/>
      <button class="btn-icono peligro" onclick="quitarConcepto('${claveLista}', ${i})" title="Quitar">✕</button>
    </div>`).join('');
}

function agregarConcepto(claveLista) {
  if (!Array.isArray(TURNO[claveLista])) TURNO[claveLista] = [];
  TURNO[claveLista].push({ id: nuevoId('cp'), desc: '', monto: 0 });
  guardarTurno();
  if (claveLista === 'otrosIngresos') renderPanelIngresos(); else renderPanelEgresos();
  // Enfocar el campo recién creado
  const cont = document.getElementById(claveLista === 'otrosIngresos' ? 'lista-otros-ingresos' : `lista-${claveLista}`);
  const inp = cont?.querySelector('.concepto:last-child input');
  if (inp) inp.focus();
}

function onConcepto(claveLista, i, campo, valor) {
  const item = (TURNO[claveLista] || [])[i];
  if (!item) return;
  item[campo] = campo === 'monto' ? Math.max(0, redondear(valor)) : valor;
  guardarTurno();
  // Cambiar de cuenta mueve saldos aunque el importe no cambie
  if (campo === 'origen') { actualizarBadgeCuadre(); if (TAB_CORTE === 'cuadre') renderCorte(); }
  if (campo === 'monto') {
    if (claveLista === 'otrosIngresos') {
      setText('otros-ingresos-total', fmt(sumaLista(TURNO.otrosIngresos)));
      refrescarTotalesIngresos();
    } else {
      setText(`total-${claveLista}`, fmt(sumaLista(TURNO[claveLista])));
      setText('egresos-total', fmt(totalEgresos()));
    }
    actualizarBadgeCuadre();
  }
}

function quitarConcepto(claveLista, i) {
  (TURNO[claveLista] || []).splice(i, 1);
  guardarTurno();
  if (claveLista === 'otrosIngresos') renderPanelIngresos(); else renderPanelEgresos();
  actualizarBadgeCuadre();
}

function guardarSugerenciaConcepto(clave, valor) { addSugerencia(clave, valor); }

/* --------------------------------------------------------- panel: saldos */
/** Los movimientos entre cuentas del turno, dentro del corte. */
function renderTraspasosCorte() {
  const cont = document.getElementById('sal-traspasos');
  if (!cont) return;
  const lista = TURNO.traspasos || [];

  if (!lista.length) {
    cont.innerHTML = `<p class="hint">Sin movimientos entre cuentas en este turno.</p>`;
    return;
  }
  cont.innerHTML = lista.map((t, i) => `
    <div class="concepto-fila">
      <span class="pill pill-abono">${esc(CUENTAS[t.origen]?.label || '?')} →
        ${esc(CUENTAS[t.destino]?.label || '?')}</span>
      <span class="cf-desc">${esc(t.desc || 'Sin concepto')}</span>
      <span class="mono">${fmt(t.monto)}</span>
      <button class="btn-icono peligro" title="Quitar" onclick="quitarTraspasoCorte(${i})">
        ${icono('bote', 15)}</button>
    </div>`).join('');
  pintarIconos(cont);
}

async function quitarTraspasoCorte(i) {
  await quitarTraspaso(i);
  renderCorte();
}

function renderPanelSaldos() {
  setVal('sal-mp-inicial', TURNO.mpInicial || '');
  setVal('sal-mp-retiros', TURNO.mpRetiros || '');
  setVal('sal-mp-cierre', TURNO.mpCierre || '');
  setVal('sal-cartera-inicial', TURNO.carteraInicial || '');
  setVal('sal-dotacion', TURNO.dotacion || '');
  setVal('sal-cartera-cierre', TURNO.carteraCierre || '');
  // La dotación sólo se muestra si un corte viejo la traía: lo nuevo son traspasos
  show('sal-dotacion-wrap', num(TURNO.dotacion) > 0, 'flex');
  renderTraspasosCorte();

  // La tarjeta de crédito sólo aparece si está activa, o si este turno ya
  // tiene algo capturado (para no esconder datos de un corte anterior).
  const mostrarTC = CONFIG.tarjetaCreditoActiva ||
    num(TURNO.tcInicial) || num(TURNO.tcCierre) || (TURNO.traspasos || []).some(t => t.destino === 'tc');
  show('sal-tc-tarjeta', mostrarTC, 'block');
  if (mostrarTC) {
    setText('sal-tc-titulo', CUENTAS.tc.largo);
    setVal('sal-tc-inicial', TURNO.tcInicial || '');
    setVal('sal-tc-cierre', TURNO.tcCierre || '');
  }

  const c = calcularCuadre();
  setText('sal-mp-esperado', fmt(c.esperadoMp));
  setText('sal-cartera-esperado', fmt(c.esperadoCart));
  setText('sal-mp-dif', fmtDiff(c.difMp));
  setText('sal-cartera-dif', fmtDiff(c.difCart));
  document.getElementById('sal-mp-dif')?.classList.toggle('malo', !igualDinero(c.difMp, 0));
  document.getElementById('sal-cartera-dif')?.classList.toggle('malo', !igualDinero(c.difCart, 0));
  if (mostrarTC) {
    setText('sal-tc-esperado', fmt(c.esperadoTC));
    setText('sal-tc-dif', fmtDiff(c.difTC));
    document.getElementById('sal-tc-dif')?.classList.toggle('malo', !igualDinero(c.difTC, 0));
  }
}

function onSaldo(clave, valor) {
  TURNO[clave] = Math.max(0, redondear(valor));
  guardarTurno();
  renderPanelSaldos();
  actualizarBadgeCuadre();
}

function onObservaciones(valor) { TURNO.obs = valor; guardarTurno(); }

/* --------------------------------------------------------- panel: cuadre */
function renderCuadre() {
  const cont = document.getElementById('cuadre-bloques');
  if (!cont) return;
  const snap = snapshotTurno();
  const c = calcularCuadre(snap);

  cont.innerHTML = c.bloques.map(b => {
    // Un bloque de deuda (la tarjeta de crédito) lee al revés: deber MÁS de
    // lo esperado es la mala noticia, no "sobra"; y el texto no es "tener".
    const deuda = !!b.esDeuda;
    const malo  = deuda ? b.dif > 0 : b.dif < 0;
    const claseDif = b.ok ? 'ok' : (malo ? 'falta' : 'sobra');
    const tituloPista = deuda
      ? (b.dif > 0 ? `Debes ${fmt(b.dif)} más de lo esperado` : `Debes ${fmt(Math.abs(b.dif))} menos de lo esperado`)
      : (b.dif > 0 ? `Sobran ${fmt(b.dif)}` : `Faltan ${fmt(Math.abs(b.dif))}`);
    return `
    <div class="cuadre-card ${b.ok ? 'ok' : 'alerta'}">
      <div class="cuadre-head">
        <span class="cuadre-ico">${icono(b.icono, 20)}</span>
        <h3>${b.label}</h3>
        <span class="dif-chip ${claseDif}">
          ${b.ok ? 'Cuadra' : fmtDiff(b.dif)}
        </span>
      </div>
      <div class="cuadre-detalle">
        ${b.renglones.map(([lbl, val, tipo]) => `
          <div class="ren ${tipo}"><span>${lbl}</span><span class="mono">${fmt(val)}</span></div>`).join('')}
        <div class="ren total"><span>${deuda ? 'Deberías deber' : 'Deberías tener'}</span><span class="mono">${fmt(b.esperado)}</span></div>
        <div class="ren contado"><span>${deuda ? 'Debes en realidad' : 'Tienes en realidad'}</span><span class="mono">${fmt(b.contado)}</span></div>
      </div>
      ${b.ok ? '' : `<div class="cuadre-pistas">
        <strong>${tituloPista}</strong>
        <ul>${b.pistas.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>`}
    </div>`;
  }).join('');

  /* resumen general */
  const res = document.getElementById('cuadre-resumen');
  if (res) {
    res.className = 'semaforo ' + (c.todoOk ? 'ok' : 'alerta');
    res.innerHTML = `
      <div class="semaforo-ico">${icono(c.todoOk ? 'palomita' : 'alerta', 28)}</div>
      <div class="semaforo-txt">
        <strong>${c.todoOk ? 'Todo cuadra: puedes cerrar el turno' : 'Hay diferencias por revisar'}</strong>
        <span>${c.todoOk
          ? 'Caja, Mercado Pago y cartera coinciden con lo esperado.'
          : c.bloques.filter(b => !b.ok).map(b => `${b.label}: ${fmtDiff(b.dif)}`).join(' · ')}</span>
      </div>`;
  }

  setText('cuadre-fisico', fmt(c.totalFisico));
  setText('cuadre-digital', fmt(c.totalDigital));
  setText('cuadre-total', fmt(c.totalValorizado));
  setText('cuadre-venta', fmt(c.ventaTotal));

  const btn = document.getElementById('btn-cerrar-turno');
  if (btn) btn.innerHTML = TURNO.editandoCorteId
    ? `${icono('bajar')}Guardar cambios del corte`
    : `${icono('balanza')}Cerrar turno y hacer corte`;

  actualizarBadgeCuadre(c);
}

/** Punto verde/rojo en la pestaña Cuadre, visible desde cualquier panel. */
function actualizarBadgeCuadre(cuadre = null) {
  const c = cuadre || calcularCuadre();
  const el = document.getElementById('badge-cuadre');
  if (el) {
    el.className = 'badge-tab ' + (c.todoOk ? 'ok' : 'alerta');
    el.textContent = c.todoOk ? '✓' : '!';
  }
  if (TAB_CORTE === 'efectivo') {
    setText('efectivo-esperado', fmt(c.esperadoCaja));
    const dif = document.getElementById('efectivo-dif');
    if (dif) {
      dif.textContent = igualDinero(c.difCaja, 0) ? 'Cuadra exacto' : fmtDiff(c.difCaja);
      dif.className = 'dif-chip ' + (igualDinero(c.difCaja, 0) ? 'ok' : c.difCaja > 0 ? 'sobra' : 'falta');
    }
  }
}

/* ======================================================== REPORTE ====== */
let CORTE_MOSTRADO = null;

function renderPanelReporte() {
  if (CORTE_MOSTRADO) { pintarReporte(CORTE_MOSTRADO); return; }
  // Vista previa en vivo del turno abierto
  if (TURNO.abierto) {
    const snap = snapshotTurno();
    const c = calcularCuadre(snap);
    pintarReporte({
      ...snap, id: 'preview', fechaHora: new Date().toISOString(),
      esperadoCaja: c.esperadoCaja, difCaja: c.difCaja,
      esperadoMp: c.esperadoMp, difMp: c.difMp,
      esperadoCartera: c.esperadoCart, difCartera: c.difCart,
      comisionTerminalMonto: c.comisionTerminal, tarjetaNeto: c.tarjetaNeto,
      totalFisico: c.totalFisico, totalDigital: c.totalDigital,
      totalValorizado: c.totalValorizado, ventaTotal: c.ventaTotal,
      cuadrado: c.todoOk, preliminar: true,
    }, true);
    return;
  }
  const ultimo = Store.get(DB.cortes, [])[0];
  if (ultimo) pintarReporte(ultimo);
  else setHTML('reporte-contenido', `<div class="vacio"><div class="vacio-ico">${icono('ticket', 34)}</div>
    <h3>Todavía no hay cortes</h3><p>Cuando cierres tu primer turno, el reporte aparecerá aquí.</p></div>`);
}

function mostrarReporteCorte(corte) {
  CORTE_MOSTRADO = corte;
  pintarReporte(corte);
}

function pintarReporte(c, preliminar = false) {
  const cont = document.getElementById('reporte-contenido');
  if (!cont) return;
  const cuadre = calcularCuadre(c);

  const denomFilas = c.cierreModo === 'rapido'
    ? `<tr><td colspan="3" class="centro hint">Se capturó el total sin desglose por denominación.</td></tr>`
    : DENOMINACIONES.map(d => {
        const q = num((c.piezasCierre || {})[d.valor]);
        return `<tr class="${q ? '' : 'apagada'}">
          <td>${d.label}</td>
          <td class="der">${q ? fmtNum(q, q % 1 ? 2 : 0) : '—'}</td>
          <td class="der mono">${q ? fmt(q * d.valor) : '—'}</td></tr>`;
      }).join('');

  const listaEgresos = [
    ['Proveedores', c.proveedores], ['Servicios', c.servicios],
    ['Honorarios', c.honorarios], ['Otras salidas', c.otrosEgresos],
  ].flatMap(([titulo, lista]) => (lista || []).filter(x => num(x.monto) > 0).map(x =>
    `<tr><td>${titulo}: ${esc(x.desc || 'Sin concepto')}</td><td class="der mono malo">−${fmt(x.monto)}</td></tr>`));

  const listaOtrosIng = (c.otrosIngresosList || []).filter(x => num(x.monto) > 0).map(x =>
    `<tr><td>Otro ingreso: ${esc(x.desc || 'Sin concepto')}</td><td class="der mono bueno">${fmt(x.monto)}</td></tr>`);

  cont.innerHTML = `
    <div class="reporte" id="reporte-imprimible">
      ${preliminar ? `<div class="aviso-preliminar">Vista previa del turno en curso. Los datos se congelan al cerrar el turno.</div>` : ''}

      <header class="rep-head">
        <div>
          <h2>Corte de caja</h2>
          <p>${esc(CONFIG.negocio)} · ${fechaLarga(c.fecha)}</p>
        </div>
        <div class="rep-meta">
          <span><b>Responsable</b>${esc(c.cajero || '—')}</span>
          <span><b>Turno</b>${esc(c.horario || c.turno || '—')}</span>
          <span><b>Cerrado</b>${preliminar ? 'En curso' : fechaHoraCorta(c.fechaHora)}</span>
          <span class="rep-estado ${cuadre.todoOk ? 'ok' : 'alerta'}">${cuadre.todoOk ? 'Cuadrado' : 'Con diferencias'}</span>
        </div>
      </header>

      <section class="rep-kpis">
        <div class="kpi"><span>Venta total del turno</span><strong class="bueno">${fmt(cuadre.ventaTotal)}</strong></div>
        <div class="kpi"><span>Efectivo en caja</span><strong>${fmt(c.efectivoContado)}</strong></div>
        <div class="kpi"><span>Saldo Mercado Pago</span><strong>${fmt(c.mpCierre)}</strong></div>
        <div class="kpi"><span>Total valorizado</span><strong class="oro">${fmt(cuadre.totalValorizado)}</strong></div>
      </section>

      <section class="rep-grid">
        <div class="rep-bloque">
          <h3>Efectivo contado al cierre</h3>
          <table class="tabla">
            <thead><tr><th>Denominación</th><th class="der">Piezas</th><th class="der">Importe</th></tr></thead>
            <tbody>${denomFilas}</tbody>
            <tfoot><tr><th>Total contado</th><th></th><th class="der mono">${fmt(c.efectivoContado)}</th></tr></tfoot>
          </table>
        </div>

        <div class="rep-bloque">
          <h3>Movimientos del turno</h3>
          <table class="tabla">
            <tbody>
              <tr><td>Fondo de apertura</td><td class="der mono">${fmt(c.fondoApertura)}</td></tr>
              <tr><td>Ventas en efectivo</td><td class="der mono bueno">${fmt(c.ventaEfectivo)}</td></tr>
              <tr><td>Cobros con tarjeta (bruto)</td><td class="der mono bueno">${fmt(c.tarjeta)}</td></tr>
              <tr class="sub"><td>└ Comisión de terminal (${fmtNum(CONFIG.comisionTerminalPct, 2)}%)</td><td class="der mono malo">−${fmt(cuadre.comisionTerminal)}</td></tr>
              <tr class="sub"><td>└ Neto que llega al banco</td><td class="der mono">${fmt(cuadre.tarjetaNeto)}</td></tr>
              <tr><td>Transferencias recibidas</td><td class="der mono bueno">${fmt(c.transferencia)}</td></tr>
              <tr><td>Cobro de fiados</td><td class="der mono bueno">${fmt(c.pagoCreditos)}</td></tr>
              ${listaOtrosIng.join('')}
              <tr><td>Recargas cobradas en efectivo</td><td class="der mono bueno">${fmt(c.totalRecargas)}</td></tr>
              <tr class="sub"><td>└ Comisión devuelta por Mercado Pago</td><td class="der mono bueno">${fmt(c.comisionRecargas)}</td></tr>
              ${listaEgresos.join('')}
              <tr><td><b>Total de egresos</b></td><td class="der mono malo"><b>−${fmt(c.egresos)}</b></td></tr>
              ${(() => {
                const e = c.egresosPorCuenta;
                if (!e) return '';   // corte viejo: todo salía de la caja
                return Object.entries(CUENTAS)
                  .filter(([k]) => num(e[k]) > 0)
                  .map(([k, cta]) => `<tr class="sub"><td>└ Desde ${cta.largo}</td>
                    <td class="der mono">−${fmt(e[k])}</td></tr>`).join('');
              })()}
              ${num(c.dotacion) > 0 ? `<tr><td>Dotación a cartera</td><td class="der mono malo">−${fmt(c.dotacion)}</td></tr>` : ''}
              ${(c.traspasos || []).map(t => `<tr><td>Traspaso · ${esc(t.desc || 'sin concepto')}
                <span class="hint">${CUENTAS[t.origen]?.label} → ${CUENTAS[t.destino]?.label}</span></td>
                <td class="der mono">${fmt(t.monto)}</td></tr>`).join('')}
              ${num(c.creditoClientes) > 0 ? `<tr><td>Vendido a crédito (no entró dinero)</td><td class="der mono">${fmt(c.creditoClientes)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </section>

      <section class="rep-conciliacion">
        ${cuadre.bloques.map(b => `
          <div class="rep-conc ${b.ok ? 'ok' : 'alerta'}">
            <h4>${icono(b.icono, 16)}${b.label}</h4>
            <div class="conc-linea"><span>${b.esDeuda ? 'Deberías deber' : 'Deberías tener'}</span><span class="mono">${fmt(b.esperado)}</span></div>
            <div class="conc-linea"><span>${b.esDeuda ? 'Debes' : 'Tienes'}</span><span class="mono">${fmt(b.contado)}</span></div>
            <div class="conc-linea res"><span>Diferencia</span><span class="mono ${b.ok ? 'bueno' : 'malo'}">${b.ok ? 'Cuadra' : fmtDiff(b.dif)}</span></div>
            ${b.ok ? '' : `<p class="hint">${b.pistas[0] || ''}</p>`}
          </div>`).join('')}
      </section>

      ${c.pos && c.pos.numVentas ? `
      <section class="rep-bloque">
        <h3>Actividad del punto de venta</h3>
        <div class="rep-kpis pequeno">
          <div class="kpi"><span>Ventas</span><strong>${fmtNum(c.pos.numVentas)}</strong></div>
          <div class="kpi"><span>Artículos vendidos</span><strong>${fmtNum(c.pos.piezas, c.pos.piezas % 1 ? 2 : 0)}</strong></div>
          <div class="kpi"><span>Ticket promedio</span><strong>${fmt(c.pos.numVentas ? c.pos.totalVendido / c.pos.numVentas : 0)}</strong></div>
          <div class="kpi"><span>Recargas</span><strong>${fmtNum(c.pos.numRecargas)}</strong></div>
        </div>
      </section>` : ''}

      ${c.obs ? `<section class="rep-obs"><strong>Observaciones</strong><p>${esc(c.obs)}</p></section>` : ''}
      ${c.notas ? `<section class="rep-obs"><strong>Notas del turno</strong><p>${esc(c.notas)}</p></section>` : ''}

      <footer class="rep-pie">
        <div class="firma"><span></span>Entrega (cajero)</div>
        <div class="firma"><span></span>Recibe (encargado)</div>
      </footer>
    </div>

    <div class="reporte-acciones no-imprimir">
      <button class="btn btn-primary" onclick="imprimirReporte()">${icono('imprimir')}Imprimir o guardar en PDF</button>
      <button class="btn btn-ghost" onclick="exportarCorteTXT()">${icono('recibo')}Descargar TXT</button>
      ${preliminar ? '' : `<button class="btn btn-ghost" onclick="exportarRespaldo()">${icono('bajar')}Respaldo completo</button>`}
      ${!preliminar && TURNO.abierto
        ? `<button class="btn btn-ghost" onclick="volverAlTurnoEnCurso()">${icono('regresar')}Ver el turno en curso</button>` : ''}
      ${!TURNO.abierto
        ? `<button class="btn btn-ghost" onclick="salirDeConsulta()" style="margin-left:auto">${icono('candado')}Abrir el siguiente turno</button>` : ''}
    </div>`;

  if (!preliminar) CORTE_MOSTRADO = c;
}

/** Vuelve del reporte de un corte guardado a la vista en vivo del turno. */
function volverAlTurnoEnCurso() {
  CORTE_MOSTRADO = null;
  renderPanelReporte();
}

/** Sale del modo consulta y deja lista la pantalla de apertura. */
function salirDeConsulta() {
  CORTE_MOSTRADO = null;
  actualizarEstadoGlobal();
  irA('apertura');
}

function imprimirReporte() {
  document.body.classList.add('imprimiendo-reporte');
  window.print();
  setTimeout(() => document.body.classList.remove('imprimiendo-reporte'), 800);
}

/* ------------------------------------------------------------- TXT plano */
async function exportarCorteTXT() {
  const c = CORTE_MOSTRADO || (TURNO.abierto ? snapshotTurno() : Store.get(DB.cortes, [])[0]);
  if (!c) { toast('No hay ningún corte que exportar.', 'warn'); return; }
  const cuadre = calcularCuadre(c);

  const linea = (izq, der) => `  ${String(izq).padEnd(38)}${String(der).padStart(14)}`;
  const sep   = '  ' + '-'.repeat(52);
  const L = [];

  L.push('='.repeat(56));
  L.push(centrar(CONFIG.negocio.toUpperCase(), 56));
  L.push(centrar('CORTE DE CAJA', 56));
  L.push('='.repeat(56));
  L.push(`  Fecha       : ${c.fecha}`);
  L.push(`  Turno       : ${c.horario || c.turno || '—'}`);
  L.push(`  Responsable : ${c.cajero || '—'}`);
  L.push(`  Cerrado     : ${c.fechaHora ? fechaHoraCorta(c.fechaHora) : 'en curso'}`);
  L.push('');

  L.push('  1. EFECTIVO CONTADO AL CIERRE');
  L.push(sep);
  if (c.cierreModo === 'rapido') {
    L.push('  (captura rápida, sin desglose por denominación)');
  } else {
    DENOMINACIONES.forEach(d => {
      const q = num((c.piezasCierre || {})[d.valor]);
      if (q > 0) L.push(linea(`${d.label} × ${fmtNum(q, q % 1 ? 2 : 0)}`, fmt(q * d.valor)));
    });
  }
  L.push(linea('TOTAL CONTADO', fmt(c.efectivoContado)));
  L.push('');

  L.push('  2. INGRESOS');
  L.push(sep);
  L.push(linea('Ventas en efectivo', fmt(c.ventaEfectivo)));
  L.push(linea('Cobros con tarjeta (bruto)', fmt(c.tarjeta)));
  L.push(linea(`  menos comisión ${fmtNum(CONFIG.comisionTerminalPct, 2)}%`, '-' + fmt(cuadre.comisionTerminal)));
  L.push(linea('  neto al banco', fmt(cuadre.tarjetaNeto)));
  L.push(linea('Transferencias / SPEI', fmt(c.transferencia)));
  L.push(linea('Cobro de fiados', fmt(c.pagoCreditos)));
  (c.otrosIngresosList || []).filter(x => num(x.monto) > 0)
    .forEach(x => L.push(linea(`Otro: ${x.desc || 'sin concepto'}`, fmt(x.monto))));
  L.push(linea('Recargas cobradas', fmt(c.totalRecargas)));
  L.push(linea('  comisión devuelta por MP', fmt(c.comisionRecargas)));
  if (num(c.creditoClientes) > 0) L.push(linea('Vendido a crédito (por cobrar)', fmt(c.creditoClientes)));
  L.push('');

  L.push('  3. EGRESOS');
  L.push(sep);
  let hubo = false;
  [['Proveedor', c.proveedores], ['Servicio', c.servicios], ['Honorario', c.honorarios], ['Otro', c.otrosEgresos]]
    .forEach(([et, lista]) => (lista || []).filter(x => num(x.monto) > 0).forEach(x => {
      hubo = true; L.push(linea(`${et}: ${x.desc || 'sin concepto'}`, '-' + fmt(x.monto)));
    }));
  if (!hubo) L.push('  Sin egresos registrados.');
  L.push(linea('TOTAL EGRESOS', '-' + fmt(c.egresos)));
  if (c.egresosPorCuenta) {
    Object.entries(CUENTAS).forEach(([k, cta]) => {
      if (num(c.egresosPorCuenta[k]) > 0) L.push(linea('  desde ' + cta.largo, '-' + fmt(c.egresosPorCuenta[k])));
    });
  }
  if (num(c.dotacion) > 0) L.push(linea('Dotación a cartera', '-' + fmt(c.dotacion)));
  if ((c.traspasos || []).length) {
    L.push('');
    L.push('  MOVIMIENTOS ENTRE CUENTAS (no son gasto)');
    c.traspasos.forEach(t => L.push(linea(
      `  ${CUENTAS[t.origen]?.label} -> ${CUENTAS[t.destino]?.label}` + (t.desc ? ` · ${t.desc}` : ''),
      fmt(t.monto))));
  }
  L.push('');

  L.push('  4. CONCILIACIÓN');
  L.push(sep);
  cuadre.bloques.forEach(b => {
    L.push(`  ${b.label.toUpperCase()}`);
    b.renglones.forEach(([lbl, val]) => L.push(linea('  ' + lbl.replace(/^[+−-]\s*/, m => m), fmt(val))));
    L.push(linea(b.esDeuda ? '  = Deberías deber' : '  = Deberías tener', fmt(b.esperado)));
    L.push(linea(b.esDeuda ? '    Debes' : '    Tienes', fmt(b.contado)));
    L.push(linea('    Diferencia', b.ok ? 'CUADRA' : fmtDiff(b.dif)));
    if (!b.ok && b.pistas.length) b.pistas.forEach(p => L.push(`     · ${p}`));
    L.push('');
  });

  L.push('  5. RESUMEN');
  L.push(sep);
  L.push(linea('Venta total del turno', fmt(cuadre.ventaTotal)));
  L.push(linea('Total físico (caja + cartera)', fmt(cuadre.totalFisico)));
  L.push(linea('Total digital (Mercado Pago)', fmt(cuadre.totalDigital)));
  L.push(linea('TOTAL VALORIZADO', fmt(cuadre.totalValorizado)));
  L.push('');
  if (c.obs)   { L.push('  OBSERVACIONES:'); L.push('  ' + c.obs); L.push(''); }
  L.push('='.repeat(56));
  L.push(centrar(cuadre.todoOk ? 'CORTE CUADRADO' : 'CORTE CON DIFERENCIAS', 56));
  L.push('='.repeat(56));
  L.push('');
  L.push('  Entrega: ______________________   Recibe: ______________________');

  const nombre = `corte_${(c.cajero || 'cajero').replace(/\s+/g, '_')}_${c.fecha || hoyISO()}.txt`;
  if (await descargarArchivo(nombre, L.join('\r\n'), 'text/plain')) {
    toast('Corte exportado en TXT.', 'success');
  }
}

function centrar(txt, ancho) {
  const s = String(txt);
  const pad = Math.max(0, Math.floor((ancho - s.length) / 2));
  return ' '.repeat(pad) + s;
}

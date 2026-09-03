/* ============================================================================
   TANICHI · FIADOS (CUENTAS POR COBRAR) Y CONSULTA DE TICKETS
   ---------------------------------------------------------------------------
   No hay una "base de clientes" aparte: la cuenta de cada persona se deduce
   de los movimientos, que son la única verdad. Así nunca puede haber un saldo
   guardado que no cuadre con los tickets.

     cargo  = lo que se llevó fiado   (pago con método 'credito')
     abono  = lo que ha pagado        (movimiento tipo 'abono')
              + devoluciones cargadas a su cuenta
     saldo  = cargos − abonos
   ========================================================================== */

let FIADOS = { busqueda: '', filtro: 'deben', cuentaAbierta: null };
let CONSULTA = { busqueda: '', tipo: 'todos' };

/* --------------------------------------------------------------- clientes */

/** Dos formas de escribir el mismo nombre son el mismo cliente. */
function claveCliente(nombre) {
  return String(nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Reconstruye la cuenta de cada persona a partir de los movimientos. */
function cuentasFiado() {
  const cuentas = new Map();
  const tomar = (nombre) => {
    const clave = claveCliente(nombre);
    if (!cuentas.has(clave)) {
      cuentas.set(clave, { clave, nombre: String(nombre).trim(), cargos: 0, abonos: 0, saldo: 0, movs: [] });
    }
    return cuentas.get(clave);
  };

  // Del más viejo al más nuevo: el estado de cuenta se lee hacia abajo.
  const movs = [...getVentas()].sort((a, b) => String(a.fechaHora).localeCompare(String(b.fechaHora)));

  movs.forEach(v => {
    if (v.cancelada) return;
    const nombre = String(v.cliente || '').trim();
    if (!nombre) return;

    const base = {
      id: v.id, folio: v.folio, fecha: v.fecha, fechaHora: v.fechaHora,
      cajero: v.cajero || '', cargo: 0, abono: 0,
    };

    /* Deuda que ya existía en la libreta, capturada a mano. No es una venta:
       no movió dinero ni inventario, sólo abre la cuenta con su saldo. */
    if (v.tipo === 'saldoInicial') {
      const c = tomar(nombre);
      c.cargos += num(v.total);
      c.movs.push({ ...base, clase: 'fiado', cargo: num(v.total),
                    concepto: 'Deuda anterior' + (v.nota ? ` · ${v.nota}` : '') });
      return;
    }

    if (v.tipo === 'abono') {
      const c = tomar(nombre);
      const como = (v.pagos || []).map(p => METODOS_PAGO[p.metodo]?.label || p.metodo).join(' + ');
      c.abonos += num(v.total);
      c.movs.push({ ...base, clase: 'abono', concepto: `Abono a cuenta · ${como}`, abono: num(v.total) });
      return;
    }

    // Sólo la parte fiada de la venta entra a la cuenta; lo demás ya se cobró.
    const credito = (v.pagos || [])
      .filter(p => p.metodo === 'credito')
      .reduce((s, p) => s + num(p.monto), 0);
    if (credito <= 0) return;

    const c = tomar(nombre);
    const detalle = (v.items || []).map(i =>
      `${fmtNum(i.cantidad, num(i.cantidad) % 1 ? 2 : 0)}× ${i.nombre}`).join(', ');

    if (v.tipo === 'devolucion') {
      // Se le regresó mercancía descontándosela de lo que debe
      c.abonos += credito;
      c.movs.push({ ...base, clase: 'devolucion', concepto: `Devolución · ${detalle}`, abono: credito });
      return;
    }

    c.cargos += credito;
    const parcial = credito < num(v.total);
    c.movs.push({
      ...base, clase: 'fiado', cargo: credito,
      concepto: `Fiado · ${detalle}` + (parcial ? ` (abonó ${fmt(num(v.total) - credito)} al llevarlo)` : ''),
    });
  });

  const lista = [...cuentas.values()];
  lista.forEach(c => {
    c.cargos = redondear(c.cargos);
    c.abonos = redondear(c.abonos);
    c.saldo  = redondear(c.cargos - c.abonos);
    let acum = 0;
    c.movs.forEach(m => { acum = redondear(acum + m.cargo - m.abono); m.saldoAcum = acum; });
    // fechaCorta() quiere el día suelto; horaDe(), la marca completa
    const fin = c.movs[c.movs.length - 1];
    c.ultimo    = fin ? fin.fechaHora : '';
    c.ultimoDia = fin ? fin.fecha : '';
    c.desde     = c.movs.length ? c.movs[0].fecha : '';
  });

  // Primero quien más debe; los saldados, hasta abajo
  return lista.sort((a, b) => (b.saldo - a.saldo) || a.nombre.localeCompare(b.nombre, 'es'));
}

function cuentaDe(nombre) {
  const clave = claveCliente(nombre);
  return cuentasFiado().find(c => c.clave === clave) || null;
}

/** Lo que debe una persona ahora mismo (0 si no tiene cuenta). */
function saldoDe(nombre) {
  const c = cuentaDe(nombre);
  return c ? c.saldo : 0;
}

function totalPorCobrar() {
  return redondear(cuentasFiado().reduce((s, c) => s + Math.max(0, c.saldo), 0));
}

/* ------------------------------------------------------------ vista fiados */

function renderFiados() {
  const cuentas = cuentasFiado();
  const conSaldo = cuentas.filter(c => c.saldo > 0.005);
  const aFavor   = cuentas.filter(c => c.saldo < -0.005);

  /* --- indicadores de arriba --- */
  setText('fi-total',     fmt(totalPorCobrar()));
  setText('fi-personas',  fmtNum(conSaldo.length));
  setText('fi-mayor',     conSaldo.length ? fmt(conSaldo[0].saldo) : '$0.00');
  setText('fi-mayor-quien', conSaldo.length ? conSaldo[0].nombre : '—');

  // Lo que se movió en el turno abierto
  const delTurno = TURNO.abierto
    ? getVentas().filter(v => v.turnoId === TURNO.id && !v.cancelada)
    : [];
  const fiadoHoy = redondear(delTurno.reduce((s, v) =>
    s + (v.tipo === 'venta' ? (v.pagos || []).filter(p => p.metodo === 'credito').reduce((a, p) => a + num(p.monto), 0) : 0), 0));
  const abonadoHoy = redondear(delTurno.filter(v => v.tipo === 'abono').reduce((s, v) => s + num(v.total), 0));
  setText('fi-fiado-turno',   fmt(fiadoHoy));
  setText('fi-abonado-turno', fmt(abonadoHoy));

  show('fi-aviso-favor', aFavor.length > 0, 'block');
  if (aFavor.length) {
    setHTML('fi-aviso-favor', `${icono('alerta', 18)} <div><strong>${aFavor.length} cuenta(s) con saldo a favor.</strong>
      Alguien abonó de más o se le devolvió mercancía ya pagada:
      ${esc(aFavor.map(c => `${c.nombre} (${fmt(-c.saldo)})`).join(', '))}.</div>`);
  }

  /* --- tabla --- */
  const q = FIADOS.busqueda.toLowerCase().trim();
  let filas = cuentas;
  if (FIADOS.filtro === 'deben')    filas = filas.filter(c => c.saldo > 0.005);
  if (FIADOS.filtro === 'saldados') filas = filas.filter(c => Math.abs(c.saldo) <= 0.005);
  if (q) filas = filas.filter(c => c.nombre.toLowerCase().includes(q));

  $$('#fi-filtros .chip').forEach(b => b.classList.toggle('activo', b.dataset.filtro === FIADOS.filtro));

  const cont = document.getElementById('fi-tabla');
  if (!cont) return;

  if (!filas.length) {
    cont.innerHTML = `<div class="vacio"><div class="vacio-ico">${icono('personas', 34)}</div>
      <p>${q ? 'Nadie con ese nombre.'
            : FIADOS.filtro === 'deben' ? 'Nadie debe nada. Todas las cuentas están al corriente.'
            : 'Todavía no hay cuentas de fiado.'}</p>
      <p class="hint">Se abre una cuenta sola en cuanto cobras una venta con la forma de pago <strong>Fiado</strong>.</p></div>`;
    return;
  }

  cont.innerHTML = `
    <table class="tabla">
      <thead><tr>
        <th>Cliente</th><th class="der">Se ha llevado</th><th class="der">Ha pagado</th>
        <th class="der">Debe</th><th>Último movimiento</th><th class="der">Acciones</th>
      </tr></thead>
      <tbody>${filas.map(c => {
        const estado = c.saldo > 0.005 ? '' : c.saldo < -0.005 ? 'a-favor' : 'saldada';
        return `
        <tr class="fi-fila ${estado}">
          <td><strong>${esc(c.nombre)}</strong>
              <div class="hint">${fmtNum(c.movs.length)} movimiento(s) desde ${fechaCorta(c.desde)}</div></td>
          <td class="der mono">${fmt(c.cargos)}</td>
          <td class="der mono">${fmt(c.abonos)}</td>
          <td class="der mono ${c.saldo > 0.005 ? 'saldo-debe' : c.saldo < -0.005 ? 'saldo-favor' : 'saldo-cero'}">
            ${c.saldo < -0.005 ? `${fmt(-c.saldo)} a favor` : fmt(c.saldo)}</td>
          <td>${fechaCorta(c.ultimoDia)} <span class="hint">${horaDe(c.ultimo)}</span></td>
          <td class="der"><div class="acciones">
            <button class="btn btn-ghost compacto" onclick="abrirCuenta('${esc(c.clave)}')">
              ${icono('recibo', 15)} Ver cuenta</button>
            ${c.saldo > 0.005 ? `<button class="btn btn-primary compacto" onclick="abonarA('${esc(c.nombre)}')">
              ${icono('billete', 15)} Abonar</button>` : ''}
          </div></td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr>
        <th>Total por cobrar</th>
        <th class="der mono">${fmt(filas.reduce((s, c) => s + c.cargos, 0))}</th>
        <th class="der mono">${fmt(filas.reduce((s, c) => s + c.abonos, 0))}</th>
        <th class="der mono saldo-debe">${fmt(filas.reduce((s, c) => s + c.saldo, 0))}</th>
        <th colspan="2"></th>
      </tr></tfoot>
    </table>`;
  pintarIconos(cont);
}

function buscarFiado(v)  { FIADOS.busqueda = v; renderFiados(); }
function filtrarFiados(f) { FIADOS.filtro = f; renderFiados(); }

/* ------------------------------------------------- estado de cuenta de uno */

function abrirCuenta(clave) {
  const c = cuentasFiado().find(x => x.clave === clave);
  if (!c) { toast('No se encontró esa cuenta.', 'error'); return; }
  FIADOS.cuentaAbierta = clave;
  renderCuenta();
  abrirModal('modal-cuenta');
}

function renderCuenta() {
  const c = cuentasFiado().find(x => x.clave === FIADOS.cuentaAbierta);
  if (!c) return;

  setText('cuenta-negocio', CONFIG.negocio);
  setText('cuenta-impreso', new Date().toLocaleString('es-MX'));
  setText('cuenta-nombre', c.nombre);
  setText('cuenta-saldo', c.saldo < -0.005 ? `${fmt(-c.saldo)} a favor` : fmt(c.saldo));
  const elSaldo = document.getElementById('cuenta-saldo');
  if (elSaldo) elSaldo.className = 'cuenta-saldo-val ' +
    (c.saldo > 0.005 ? 'saldo-debe' : c.saldo < -0.005 ? 'saldo-favor' : 'saldo-cero');
  setText('cuenta-resumen',
    `Se ha llevado ${fmt(c.cargos)} · Ha pagado ${fmt(c.abonos)} · ${fmtNum(c.movs.length)} movimientos`);

  setHTML('cuenta-movs', `
    <table class="tabla" id="cuenta-imprimible-tabla">
      <thead><tr><th>Fecha</th><th>Folio</th><th>Concepto</th>
        <th class="der">Se llevó</th><th class="der">Pagó</th><th class="der">Saldo</th><th class="no-imprimir"></th></tr></thead>
      <tbody>${[...c.movs].reverse().map(m => `
        <tr class="mov-${m.clase}">
          <td>${fechaCorta(m.fecha)} <span class="hint">${horaDe(m.fechaHora)}</span></td>
          <td class="mono">#${m.folio}</td>
          <td>${esc(m.concepto)}</td>
          <td class="der mono">${m.cargo ? fmt(m.cargo) : '—'}</td>
          <td class="der mono">${m.abono ? fmt(m.abono) : '—'}</td>
          <td class="der mono">${fmt(m.saldoAcum)}</td>
          <td class="der no-imprimir">
            <button class="btn-icono" title="Ver el ticket" onclick="verTicket('${m.id}')">${icono('recibo', 15)}</button>
          </td>
        </tr>`).join('')}</tbody>
    </table>`);

  const btn = document.getElementById('btn-abonar-cuenta');
  if (btn) {
    btn.disabled = c.saldo <= 0.005;
    btn.setAttribute('onclick', `abonarA('${esc(c.nombre)}')`);
  }
  pintarIconos(document.getElementById('modal-cuenta'));
}

/* ------------------------------------- dar de alta un fiado de la libreta */

function abrirAltaFiado() {
  setVal('nf-nombre', '');
  setVal('nf-monto', '');
  setVal('nf-nota', '');
  validarAltaFiado();
  abrirModal('modal-nuevo-fiado');
}

function validarAltaFiado() {
  const nombre = (document.getElementById('nf-nombre')?.value || '').trim();
  const monto  = valOf('nf-monto', 0);
  const aviso  = document.getElementById('nf-aviso');
  const btn    = document.getElementById('btn-guardar-fiado');

  const previo = nombre ? cuentaDe(nombre) : null;
  if (btn) btn.disabled = !nombre || monto <= 0;
  if (!aviso) return;

  if (!nombre)      aviso.innerHTML = `<span class="pill pill-warn">Escribe el nombre</span>`;
  else if (monto <= 0) aviso.innerHTML = `<span class="pill pill-warn">Escribe cuánto debe</span>`;
  else if (previo)  aviso.innerHTML = `<span class="pill pill-warn">${esc(previo.nombre)} ya tiene cuenta
                      y debe ${fmt(previo.saldo)}. Esto le sumaría ${fmt(monto)}.</span>`;
  else              aviso.innerHTML = `<span class="pill pill-ok">Se abre la cuenta de ${esc(nombre)} debiendo ${fmt(monto)}</span>`;
}

function guardarAltaFiado() {
  const nombre = (document.getElementById('nf-nombre')?.value || '').trim();
  const monto  = redondear(valOf('nf-monto', 0));
  const nota   = (document.getElementById('nf-nota')?.value || '').trim();
  if (!nombre || monto <= 0) { toast('Falta el nombre o el monto.', 'error'); return; }

  const mov = {
    id: nuevoId('sld'), folio: siguienteFolio(), tipo: 'saldoInicial',
    turnoId: TURNO.abierto ? TURNO.id : null,
    cajero: TURNO.cajero || '', fecha: hoyISO(), fechaHora: new Date().toISOString(),
    items: [{ productoId: null, nombre: 'Deuda anterior (libreta)', sku: '',
              precio: monto, cantidad: 1, importe: monto, tipo: 'saldoInicial' }],
    subtotal: monto, descuento: 0, total: monto,
    pagos: [],                 // no movió dinero: no toca caja ni el corte
    recibido: 0, cambio: 0, cliente: nombre, nota, cancelada: false,
  };

  const ventas = getVentas();
  ventas.unshift(mov);
  setVentas(ventas);
  addSugerencia('clientes', nombre);

  cerrarModal('modal-nuevo-fiado');
  renderFiados();
  actualizarEstadoGlobal();
  respaldarPronto('fiado-inicial');
  toast(`${nombre} quedó registrado debiendo ${fmt(monto)}.`, 'success', 5000);
}

/** Abre el cobro de abono ya con el cliente puesto. */
function abonarA(nombre) {
  if (!exigirTurnoAbierto()) return;
  cerrarModal('modal-cuenta');
  if (VISTA !== 'pos') irA('pos');
  abrirCobroAbono(nombre);
}

function imprimirCuenta() {
  document.body.classList.add('imprimiendo-cuenta');
  window.print();
  setTimeout(() => document.body.classList.remove('imprimiendo-cuenta'), 800);
}

async function exportarCuenta() {
  const c = cuentasFiado().find(x => x.clave === FIADOS.cuentaAbierta);
  if (!c) return;
  const filas = [
    [`Estado de cuenta · ${c.nombre}`], [CONFIG.negocio],
    [`Generado`, new Date().toLocaleString('es-MX')],
    [`Saldo actual`, c.saldo], [],
    ['Fecha', 'Hora', 'Folio', 'Concepto', 'Se llevó', 'Pagó', 'Saldo'],
    ...c.movs.map(m => [m.fecha, horaDe(m.fechaHora), m.folio, m.concepto, m.cargo || '', m.abono || '', m.saldoAcum]),
  ];
  await descargarArchivo(`cuenta-${c.clave.replace(/[^a-z0-9]+/g, '-')}.csv`, aCSV(filas), 'text/csv;charset=utf-8');
}

async function exportarFiados() {
  const cuentas = cuentasFiado();
  const filas = [
    ['Cuentas por cobrar · ' + CONFIG.negocio],
    ['Generado', new Date().toLocaleString('es-MX')],
    ['Total por cobrar', totalPorCobrar()], [],
    ['Cliente', 'Se ha llevado', 'Ha pagado', 'Debe', 'Movimientos', 'Último movimiento'],
    ...cuentas.map(c => [c.nombre, c.cargos, c.abonos, c.saldo, c.movs.length, fechaCorta(c.ultimoDia)]),
  ];
  await descargarArchivo('fiados.csv', aCSV(filas), 'text/csv;charset=utf-8');
  toast('Cuentas exportadas.', 'success');
}

/** Convierte una matriz a CSV con BOM, para que Excel respete los acentos. */
function aCSV(filas) {
  const celda = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n');
}

/* ==================================================== CONSULTAR UN TICKET ==
   Buscador general de movimientos: sirve para reimprimir un ticket, revisar
   qué se cobró o llegar a una devolución o corrección. */

function abrirConsulta() {
  CONSULTA.busqueda = '';
  setVal('cs-buscar', '');
  renderConsulta();
  abrirModal('modal-consulta');
}

function buscarConsulta(v) { CONSULTA.busqueda = v; renderConsulta(); }
function filtrarConsulta(t) { CONSULTA.tipo = t; renderConsulta(); }

const ETIQUETA_MOV = {
  venta: 'Venta', abono: 'Abono', recarga: 'Recarga', devolucion: 'Devolución', envio: 'Envío',
  saldoInicial: 'Deuda anterior',
};

function renderConsulta() {
  const cont = document.getElementById('cs-lista');
  if (!cont) return;

  const q = CONSULTA.busqueda.toLowerCase().trim();
  $$('#cs-filtros .chip').forEach(b => b.classList.toggle('activo', b.dataset.tipo === CONSULTA.tipo));

  let movs = getVentas();
  if (CONSULTA.tipo !== 'todos') movs = movs.filter(v => (v.tipo || 'venta') === CONSULTA.tipo);
  if (q) {
    movs = movs.filter(v => {
      const texto = `${v.folio} ${v.cliente || ''} ${v.cajero || ''} ${fechaCorta(v.fecha)} ` +
                    (v.items || []).map(i => `${i.nombre} ${i.sku || ''}`).join(' ');
      return texto.toLowerCase().includes(q);
    });
  }
  const total = movs.length;
  movs = movs.slice(0, 80);

  if (!movs.length) {
    cont.innerHTML = `<div class="vacio pequeno"><div class="vacio-ico">${icono('buscar', 30)}</div>
      <p>${q ? 'Ningún ticket coincide con esa búsqueda.' : 'Todavía no hay movimientos.'}</p></div>`;
    return;
  }

  setText('cs-conteo', total > movs.length
    ? `Mostrando los ${movs.length} más recientes de ${fmtNum(total)}. Afina la búsqueda para ver otros.`
    : `${fmtNum(total)} movimiento(s).`);

  cont.innerHTML = movs.map(v => {
    const tipo = v.tipo || 'venta';
    const mismoTurno = TURNO.abierto && v.turnoId === TURNO.id;
    return `
      <div class="cs-fila ${v.cancelada ? 'cancelada' : ''}">
        <div class="cs-info">
          <div class="cs-cab">
            <strong>#${v.folio}</strong>
            <span class="pill pill-${tipo}">${ETIQUETA_MOV[tipo] || tipo}</span>
            ${v.cancelada ? '<span class="pill pill-off">Cancelado</span>' : ''}
            <span class="hint">${fechaCorta(v.fecha)} · ${horaDe(v.fechaHora)} · ${esc(v.cajero || '')}</span>
          </div>
          <span class="cs-detalle">${esc((v.items || []).map(i =>
            `${fmtNum(i.cantidad, num(i.cantidad) % 1 ? 2 : 0)}× ${i.nombre}`).join(', ')).slice(0, 120)}</span>
          ${v.cliente ? `<span class="hint">${icono('personas', 13)} ${esc(v.cliente)}</span>` : ''}
        </div>
        <span class="cs-total mono">${fmt(v.total)}</span>
        <div class="cs-acciones">
          <button class="btn btn-ghost compacto" onclick="verTicket('${v.id}')">${icono('recibo', 15)} Ver</button>
          ${tipo === 'venta' && !v.cancelada ? `
            <button class="btn btn-ghost compacto" onclick="cerrarModal('modal-consulta'); abrirDevolucion('${v.id}')">
              ${icono('regresar', 15)} Devolver</button>` : ''}
          ${tipo === 'venta' && !v.cancelada && mismoTurno ? `
            <button class="btn btn-ghost compacto peligro-suave" onclick="cerrarModal('modal-consulta'); corregirVenta('${v.id}')">
              ${icono('lapiz', 15)} Corregir</button>` : ''}
        </div>
      </div>`;
  }).join('');
  pintarIconos(cont);
}

/** Muestra el ticket de cualquier movimiento guardado. */
function verTicket(id) {
  const v = getVentas().find(x => x.id === id);
  if (!v) { toast('No se encontró ese ticket.', 'error'); return; }
  mostrarTicket(v);
}

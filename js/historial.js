/* ============================================================================
   TANICHI · HISTORIAL Y ANÁLISIS
   Cortes guardados, historial de ventas, buscador de conceptos y gráficas.
   Las gráficas se dibujan con SVG propio: funcionan sin internet.
   ========================================================================== */

const HIST = { tab: 'cortes', filtros: {}, rango: 30 };

function abrirHistorial(tab = 'cortes') {
  abrirModal('modal-historial');
  cambiarTabHistorial(tab);
}

function cambiarTabHistorial(tab) {
  HIST.tab = tab;
  $$('#modal-historial .modal-tab').forEach(b => b.classList.toggle('activo', b.dataset.htab === tab));
  $$('#modal-historial .htab-panel').forEach(p => p.classList.toggle('activo', p.id === `htab-${tab}`));
  if (tab === 'cortes')    renderCortes();
  if (tab === 'ventas')    renderHistorialVentas();
  if (tab === 'conceptos') buscarConceptos();
  if (tab === 'analisis')  renderAnalisis();
}

/* ------------------------------------------------------- listado cortes */
function renderCortes() {
  const cont = document.getElementById('hist-cortes-lista');
  if (!cont) return;

  const cortes = Store.get(DB.cortes, []);
  const q      = (document.getElementById('hc-buscar')?.value || '').toLowerCase().trim();
  const desde  = document.getElementById('hc-desde')?.value || '';
  const hasta  = document.getElementById('hc-hasta')?.value || '';
  const estado = document.getElementById('hc-estado')?.value || '';

  const lista = cortes.filter(c => {
    if (q && !`${c.cajero || ''} ${c.horario || c.turno || ''} ${c.obs || ''}`.toLowerCase().includes(q)) return false;
    if (desde && String(c.fecha) < desde) return false;
    if (hasta && String(c.fecha) > hasta) return false;
    if (estado === 'ok'      && !esCuadrado(c)) return false;
    if (estado === 'difiere' &&  esCuadrado(c)) return false;
    return true;
  });

  /* totales del filtro actual */
  const totVenta = redondear(lista.reduce((s, c) => s + num(calcularCuadre(c).ventaTotal), 0));
  const totDif   = redondear(lista.reduce((s, c) => s + num(calcularCuadre(c).difCaja), 0));
  setText('hc-resumen', lista.length
    ? `${lista.length} corte(s) · venta ${fmt(totVenta)} · diferencia acumulada en caja ${fmtDiff(totDif)}`
    : 'Sin resultados');

  if (!lista.length) {
    cont.innerHTML = `<div class="vacio pequeno"><div class="vacio-ico">${icono('carpeta', 34)}</div>
      <p>${cortes.length ? 'Ningún corte coincide con el filtro.' : 'Todavía no has cerrado ningún turno.'}</p></div>`;
    return;
  }

  cont.innerHTML = lista.map(c => {
    const cu = calcularCuadre(c);
    return `
    <div class="corte-item">
      <div class="corte-fecha">
        <strong>${fechaCorta(c.fecha)}</strong>
        <span>${esc(c.horario || c.turno || '')}</span>
      </div>
      <div class="corte-datos">
        <span class="corte-cajero">${esc(c.cajero || '—')}</span>
        <span class="hint">${c.pos?.numVentas ? `${fmtNum(c.pos.numVentas)} ventas en POS` : 'captura manual'}${c.editadoEn ? ' · editado' : ''}</span>
      </div>
      <div class="corte-cifras">
        <span class="mono">${fmt(cu.ventaTotal)}</span>
        <span class="hint">venta del turno</span>
      </div>
      <div class="corte-estado">
        <span class="dif-chip ${cu.todoOk ? 'ok' : cu.difCaja > 0 ? 'sobra' : 'falta'}">
          ${cu.todoOk ? 'Cuadró' : fmtDiff(cu.difCaja)}
        </span>
      </div>
      <div class="corte-acciones">
        <button class="btn-icono" title="Ver reporte" onclick="verCorte('${esc(String(c.id))}')">${icono('ojo')}</button>
        <button class="btn-icono" title="Editar corte" onclick="editarCorte('${esc(String(c.id))}')">${icono('lapiz')}</button>
        <button class="btn-icono peligro" title="Eliminar" onclick="eliminarCorte('${esc(String(c.id))}')">${icono('bote')}</button>
      </div>
    </div>`;
  }).join('');
}

function esCuadrado(c) {
  if (typeof c.cuadrado === 'boolean') return c.cuadrado;
  return calcularCuadre(c).todoOk;
}

function verCorte(id) {
  const c = Store.get(DB.cortes, []).find(x => String(x.id) === String(id));
  if (!c) return;
  cerrarModal('modal-historial');
  mostrarReporteCorte(c);
  actualizarEstadoGlobal();
  irA('corte');
  activarTabCorte('reporte');
}

async function eliminarCorte(id) {
  const c = Store.get(DB.cortes, []).find(x => String(x.id) === String(id));
  if (!c) return;
  const ok = await confirmar({
    titulo: 'Eliminar corte',
    mensaje: `Se eliminará el corte del <strong>${fechaCorta(c.fecha)}</strong> (${esc(c.horario || c.turno || '')}).<br>
              Las ventas del punto de venta no se borran.<br><br>Esta acción no se puede deshacer.`,
    ok: 'Eliminar corte', peligro: true,
  });
  if (!ok) return;
  Store.set(DB.cortes, Store.get(DB.cortes, []).filter(x => String(x.id) !== String(id)));
  renderCortes();
  respaldarPronto('borrado-corte');
  toast('Corte eliminado.', 'info');
}

async function borrarTodoHistorial() {
  const n = Store.get(DB.cortes, []).length;
  const ok = await confirmar({
    titulo: 'Borrar todo el historial de cortes',
    mensaje: `Se eliminarán <strong>${n} cortes</strong>. Descarga antes un respaldo si crees que los vas a necesitar.<br><br>
              Esta acción no se puede deshacer.`,
    ok: 'Borrar todo', peligro: true,
  });
  if (!ok) return;
  Store.set(DB.cortes, []);
  renderCortes();
  toast('Historial de cortes vacío.', 'info');
}

/* ------------------------------------------------------ historial ventas */
function renderHistorialVentas() {
  const cont = document.getElementById('hist-ventas-lista');
  if (!cont) return;

  const q     = (document.getElementById('hv-buscar')?.value || '').toLowerCase().trim();
  const desde = document.getElementById('hv-desde')?.value || '';
  const hasta = document.getElementById('hv-hasta')?.value || '';
  const tipo  = document.getElementById('hv-tipo')?.value || '';

  const lista = getVentas().filter(v => {
    if (desde && String(v.fecha) < desde) return false;
    if (hasta && String(v.fecha) > hasta) return false;
    if (tipo && v.tipo !== tipo) return false;
    if (!q) return true;
    const texto = `${v.folio} ${v.cajero || ''} ${v.cliente || ''} ${(v.items || []).map(i => i.nombre).join(' ')}`;
    return texto.toLowerCase().includes(q);
  }).slice(0, 400);

  const validas = lista.filter(v => !v.cancelada);
  setText('hv-resumen', `${validas.length} movimiento(s) · ${fmt(validas.reduce((s, v) => s + num(v.total), 0))}`);

  if (!lista.length) {
    cont.innerHTML = `<div class="vacio pequeno"><div class="vacio-ico">${icono('recibo', 34)}</div><p>Sin movimientos que mostrar.</p></div>`;
    return;
  }

  cont.innerHTML = `<table class="tabla tabla-hist">
    <thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="der">Total</th><th></th></tr></thead>
    <tbody>${lista.map(v => `
      <tr class="${v.cancelada ? 'cancelada' : ''}">
        <td class="mono">#${v.folio}</td>
        <td>${fechaCorta(v.fecha)}<span class="hint"> ${horaDe(v.fechaHora)}</span></td>
        <td>${v.tipo === 'recarga' ? 'Recarga' : v.tipo === 'abono' ? 'Abono' : 'Venta'}</td>
        <td class="celda-detalle">${esc((v.items || []).map(i => `${fmtNum(i.cantidad, num(i.cantidad) % 1 ? 2 : 0)}× ${i.nombre}`).join(', '))}
          ${v.cliente ? `<span class="hint"> · ${esc(v.cliente)}</span>` : ''}
          ${v.cancelada ? ' <span class="pill pill-off">cancelada</span>' : ''}</td>
        <td class="der mono">${fmt(v.total)}</td>
        <td class="acciones">
          <button class="btn-icono" title="Ver ticket" onclick="verTicketVenta('${v.id}')">${icono('recibo')}</button>
          ${v.tipo === 'venta' && !v.cancelada
            ? `<button class="btn-icono" title="Devolución"
                       onclick="cerrarModal('modal-historial'); abrirDevolucion('${v.id}')">${icono('regresar')}</button>`
            : ''}
        </td>
      </tr>`).join('')}</tbody></table>`;
}

async function exportarVentasCSV() {
  const ventas = getVentas();
  if (!ventas.length) { toast('No hay ventas que exportar.', 'warn'); return; }
  const cab = ['folio', 'fecha', 'hora', 'tipo', 'cajero', 'producto', 'cantidad', 'precio', 'importe', 'total_venta', 'metodos', 'cliente', 'cancelada'];
  const filas = [];
  ventas.forEach(v => {
    const metodos = (v.pagos || []).map(p => `${p.metodo}:${redondear(p.monto)}`).join(' | ');
    (v.items || []).forEach(i => filas.push([
      v.folio, v.fecha, horaDe(v.fechaHora), v.tipo, v.cajero || '',
      i.nombre, i.cantidad, redondear(i.precio), redondear(i.importe),
      redondear(v.total), metodos, v.cliente || '', v.cancelada ? 'si' : 'no',
    ]));
  });
  const csv = [cab, ...filas].map(f => f.map(celdaCSV).join(',')).join('\r\n');
  if (await descargarArchivo(`ventas_tanichi_${hoyISO()}.csv`, '﻿' + csv, 'text/csv')) {
    toast('Ventas exportadas en CSV.', 'success');
  }
}

/* ---------------------------------------------------- buscador conceptos */
function buscarConceptos() {
  const q     = (document.getElementById('bc-texto')?.value || '').toLowerCase().trim();
  const cat   = document.getElementById('bc-categoria')?.value || 'todas';
  const desde = document.getElementById('bc-desde')?.value || '';
  const hasta = document.getElementById('bc-hasta')?.value || '';

  const mapa = {
    proveedores:   { titulo: 'Proveedor',   signo: -1 },
    servicios:     { titulo: 'Servicio',    signo: -1 },
    honorarios:    { titulo: 'Honorario',   signo: -1 },
    otrosEgresos:  { titulo: 'Otra salida', signo: -1 },
    otrosIngresosList: { titulo: 'Otro ingreso', signo: +1 },
  };

  const filas = [];
  Store.get(DB.cortes, []).forEach(c => {
    if (desde && String(c.fecha) < desde) return;
    if (hasta && String(c.fecha) > hasta) return;
    Object.entries(mapa).forEach(([clave, meta]) => {
      if (cat !== 'todas' && cat !== clave) return;
      // Compatibilidad con los nombres de la versión anterior
      const lista = c[clave] || c[{
        proveedores: 'proveedoresList', servicios: 'serviciosList',
        honorarios: 'honorariosList', otrosEgresos: 'otrosRetirosList',
        otrosIngresosList: 'otrosList',
      }[clave]] || [];
      lista.forEach(x => {
        if (num(x.monto) === 0) return;
        if (q && !String(x.desc || '').toLowerCase().includes(q)) return;
        filas.push({
          fecha: c.fecha, cajero: c.cajero, turno: c.horario || c.turno || '',
          categoria: meta.titulo, signo: meta.signo,
          desc: x.desc || 'Sin concepto', monto: num(x.monto),
        });
      });
    });
  });

  filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const total = redondear(filas.reduce((s, f) => s + f.monto * f.signo, 0));
  setText('bc-total', fmt(Math.abs(total)));
  setText('bc-count', fmtNum(filas.length));
  setText('bc-neto', total < 0 ? 'salidas de efectivo' : 'entradas de efectivo');

  const cont = document.getElementById('bc-resultados');
  if (!cont) return;
  if (!filas.length) {
    cont.innerHTML = `<div class="vacio pequeno"><div class="vacio-ico">${icono('buscar', 34)}</div>
      <p>Busca un concepto para ver cuánto has gastado o recibido por él.<br>
      Ejemplos: <em>coca</em>, <em>luz</em>, <em>renta</em>.</p></div>`;
    return;
  }
  cont.innerHTML = `<table class="tabla tabla-hist">
    <thead><tr><th>Fecha</th><th>Turno</th><th>Categoría</th><th>Concepto</th><th class="der">Importe</th></tr></thead>
    <tbody>${filas.map(f => `
      <tr>
        <td>${fechaCorta(f.fecha)}</td>
        <td>${esc(f.cajero || '')}<span class="hint"> ${esc(f.turno)}</span></td>
        <td>${f.categoria}</td>
        <td>${esc(f.desc)}</td>
        <td class="der mono ${f.signo < 0 ? 'malo' : 'bueno'}">${f.signo < 0 ? '−' : ''}${fmt(f.monto)}</td>
      </tr>`).join('')}</tbody></table>`;
}

/* --------------------------------------------------------------- análisis */
function renderAnalisis() {
  const dias   = num(document.getElementById('an-rango')?.value, 30);
  const limite = new Date(); limite.setDate(limite.getDate() - dias);
  const desdeISO = hoyISO(limite);

  const cortes = Store.get(DB.cortes, []).filter(c => String(c.fecha) >= desdeISO);
  const ventas = getVentas().filter(v => !v.cancelada && String(v.fecha) >= desdeISO);

  /* ---- indicadores */
  const cuadres  = cortes.map(c => calcularCuadre(c));
  const ventaTot = redondear(cuadres.reduce((s, c) => s + c.ventaTotal, 0));
  const egresos  = redondear(cortes.reduce((s, c) => s + num(c.egresos), 0));
  const difTot   = redondear(cuadres.reduce((s, c) => s + c.difCaja, 0));
  const dias1    = new Set(cortes.map(c => c.fecha)).size || 1;
  const ticketProm = ventas.filter(v => v.tipo === 'venta').length
    ? redondear(ventas.filter(v => v.tipo === 'venta').reduce((s, v) => s + num(v.total), 0) /
                ventas.filter(v => v.tipo === 'venta').length) : 0;

  setText('an-venta', fmt(ventaTot));
  setText('an-egresos', fmt(egresos));
  setText('an-neto', fmt(ventaTot - egresos));
  setText('an-prom-dia', fmt(ventaTot / dias1));
  setText('an-ticket', fmt(ticketProm));
  setText('an-cortes', fmtNum(cortes.length));
  setText('an-dif', fmtDiff(difTot));
  document.getElementById('an-dif')?.classList.toggle('malo', !igualDinero(difTot, 0));

  /* ---- venta por día */
  const porDia = new Map();
  cortes.forEach(c => porDia.set(c.fecha, redondear(num(porDia.get(c.fecha)) + calcularCuadre(c).ventaTotal)));
  const dias2 = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-21);
  setHTML('an-chart-dias', graficaBarras(
    dias2.map(([f, v]) => ({ etiqueta: fechaCorta(f).replace(/ de \d+$/, ''), valor: v })),
    'Venta por día'));

  /* ---- métodos de pago */
  const metodos = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };
  ventas.filter(v => v.tipo === 'venta').forEach(v =>
    (v.pagos || []).forEach(p => { if (metodos[p.metodo] !== undefined) metodos[p.metodo] += num(p.monto); }));
  setHTML('an-chart-metodos', graficaDona(
    Object.entries(metodos).filter(([, v]) => v > 0)
      .map(([k, v]) => ({ etiqueta: METODOS_PAGO[k].label, valor: redondear(v) })),
    'Cómo te pagan'));

  /* ---- productos más vendidos */
  const prod = new Map();
  ventas.filter(v => v.tipo === 'venta').forEach(v => (v.items || []).forEach(i => {
    const k = i.nombre;
    const a = prod.get(k) || { piezas: 0, importe: 0 };
    a.piezas += num(i.cantidad); a.importe += num(i.importe);
    prod.set(k, a);
  }));
  const top = [...prod.entries()].sort((a, b) => b[1].importe - a[1].importe).slice(0, 10);
  setHTML('an-top-productos', top.length
    ? `<table class="tabla"><thead><tr><th>Producto</th><th class="der">Piezas</th><th class="der">Importe</th></tr></thead>
       <tbody>${top.map(([n, d]) => `<tr><td>${esc(n)}</td>
         <td class="der mono">${fmtNum(d.piezas, d.piezas % 1 ? 2 : 0)}</td>
         <td class="der mono">${fmt(d.importe)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="hint">Aún no hay ventas con productos en este periodo.</p>`);

  /* ---- egresos por categoría */
  const cats = { Proveedores: 0, Servicios: 0, Honorarios: 0, Otros: 0 };
  cortes.forEach(c => {
    cats.Proveedores += sumaLista(c.proveedores || c.proveedoresList);
    cats.Servicios   += sumaLista(c.servicios   || c.serviciosList);
    cats.Honorarios  += sumaLista(c.honorarios  || c.honorariosList);
    cats.Otros       += sumaLista(c.otrosEgresos || c.otrosRetirosList);
  });
  setHTML('an-chart-egresos', graficaDona(
    Object.entries(cats).filter(([, v]) => v > 0).map(([k, v]) => ({ etiqueta: k, valor: redondear(v) })),
    'En qué se va el efectivo'));

  /* ---- desempeño por turno */
  const porTurno = new Map();
  cortes.forEach(c => {
    const k = c.horario || c.turno || 'Sin turno';
    porTurno.set(k, redondear(num(porTurno.get(k)) + calcularCuadre(c).ventaTotal));
  });
  setHTML('an-chart-turnos', graficaBarras(
    [...porTurno.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ etiqueta: k, valor: v })), 'Venta por turno', true));
}

/* -------------------------------------------------- gráficas SVG propias
   Sin librerías externas: el sistema funciona igual sin conexión.        */
function graficaBarras(datos, titulo, horizontal = false) {
  if (!datos.length) return `<p class="hint">Sin datos para “${titulo}”.</p>`;
  const max = Math.max(...datos.map(d => d.valor)) || 1;

  if (horizontal) {
    return `<div class="barras-h">${datos.map(d => `
      <div class="bh">
        <span class="bh-lbl">${esc(d.etiqueta)}</span>
        <span class="bh-track"><span class="bh-fill" style="width:${(d.valor / max) * 100}%"></span></span>
        <span class="bh-val mono">${fmt(d.valor)}</span>
      </div>`).join('')}</div>`;
  }

  const W = 640, H = 200, padY = 24, padX = 8;
  const ancho = (W - padX * 2) / datos.length;
  const barra = Math.min(46, ancho * 0.66);

  return `
    <svg viewBox="0 0 ${W} ${H + 34}" class="grafica" role="img" aria-label="${esc(titulo)}">
      ${[0.25, 0.5, 0.75, 1].map(p => `
        <line x1="${padX}" x2="${W - padX}" y1="${H - (H - padY) * p}" y2="${H - (H - padY) * p}" class="g-guia"/>`).join('')}
      ${datos.map((d, i) => {
        const h = Math.max(2, ((d.valor / max) * (H - padY)));
        const x = padX + i * ancho + (ancho - barra) / 2;
        return `<g>
          <rect x="${x}" y="${H - h}" width="${barra}" height="${h}" rx="5" class="g-barra"><title>${esc(d.etiqueta)}: ${fmt(d.valor)}</title></rect>
          <text x="${x + barra / 2}" y="${H - h - 5}" class="g-valor">${fmtNum(d.valor / 1000, d.valor >= 10000 ? 0 : 1)}k</text>
          <text x="${x + barra / 2}" y="${H + 16}" class="g-etiqueta">${esc(String(d.etiqueta).slice(0, 11))}</text>
        </g>`;
      }).join('')}
    </svg>`;
}

function graficaDona(datos, titulo) {
  if (!datos.length) return `<p class="hint">Sin datos para “${titulo}”.</p>`;
  const total = datos.reduce((s, d) => s + d.valor, 0) || 1;
  const R = 70, r = 44, cx = 90, cy = 90;
  let angulo = -Math.PI / 2;

  const sectores = datos.map((d, i) => {
    const frac = d.valor / total;
    const fin  = angulo + frac * Math.PI * 2;
    const grande = frac > 0.5 ? 1 : 0;
    const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    // Un único valor (100%) no puede dibujarse como arco: se usa un anillo
    const d3 = frac >= 0.999
      ? `M ${cx - R},${cy} a ${R},${R} 0 1,0 ${R * 2},0 a ${R},${R} 0 1,0 ${-R * 2},0
         M ${cx - r},${cy} a ${r},${r} 0 1,1 ${r * 2},0 a ${r},${r} 0 1,1 ${-r * 2},0`
      : `M ${p(R, angulo)} A ${R},${R} 0 ${grande},1 ${p(R, fin)} L ${p(r, fin)} A ${r},${r} 0 ${grande},0 ${p(r, angulo)} Z`;
    angulo = fin;
    return `<path d="${d3}" class="g-sector g-c${i % 6}"><title>${esc(d.etiqueta)}: ${fmt(d.valor)} (${fmtNum(frac * 100, 1)}%)</title></path>`;
  }).join('');

  return `
    <div class="dona-wrap">
      <svg viewBox="0 0 180 180" class="grafica dona" role="img" aria-label="${esc(titulo)}">
        ${sectores}
        <text x="90" y="86" class="g-dona-lbl">Total</text>
        <text x="90" y="104" class="g-dona-val">${fmt(total)}</text>
      </svg>
      <ul class="dona-leyenda">
        ${datos.map((d, i) => `<li><span class="punto-color g-c${i % 6}"></span>
          ${esc(d.etiqueta)} <b class="mono">${fmt(d.valor)}</b>
          <span class="hint">${fmtNum((d.valor / total) * 100, 1)}%</span></li>`).join('')}
      </ul>
    </div>`;
}

/* ============================================================================
   TANICHI · PUNTO DE VENTA
   Cobro rápido con catálogo, carrito, pagos combinados, ticket y descuento
   automático de inventario. Cada venta queda ligada al turno abierto.
   ========================================================================== */

/* Pestaña de acceso rápido a lo que más se vende. No es una categoría del
   catálogo: es una lista calculada, por eso lleva una clave que ningún
   nombre real puede chocar. */
const CAT_TOP = '__mas-vendidos__';
const TOP_MAX = 30;

const POS = {
  carrito: [],            // [{ uid, productoId, nombre, sku, precio, cantidad, tipo }]
  descuento: 0,           // importe en pesos sobre el total
  categoria: CAT_TOP,
  busqueda: '',
  cobro: null,            // estado del modal de cobro
  ultimaVenta: null,
};

/* ------------------------------------------------------------- catálogo */
/* El catálogo y las ventas se guardan como texto JSON. Releerlos y volverlos
   a interpretar en cada tecla del buscador significaba procesar cientos de
   miles de caracteres por pulsación —con 978 productos, 0.34 MB cada vez—.
   Se recuerdan ya interpretados y sólo se sueltan cuando algo cambia. */
let _productos = null;
function getProductos() {
  if (_productos === null) _productos = Store.get(DB.productos, []);
  return _productos;
}
function setProductos(p) {
  _productos = p;
  Store.set(DB.productos, p);
  invalidarTopVendidos();
}
function invalidarProductos() { _productos = null; }

function buscarProducto(id) { return getProductos().find(p => p.id === id) || null; }

function categoriasDe(productos = getProductos()) {
  const set = new Set(productos.filter(p => p.activo !== false).map(p => (p.categoria || 'General').trim() || 'General'));
  return [CAT_TOP, 'todas', ...[...set].sort((a, b) => a.localeCompare(b, 'es'))];
}

/** Los productos más vendidos, por piezas, de todo el historial de ventas.
 *  Se calcula una vez y se recuerda: recorrer todas las ventas en cada
 *  tecleo del buscador se notaría con miles de tickets. */
let _topVendidos = null;
function invalidarTopVendidos() { _topVendidos = null; }

function topVendidos(limite = TOP_MAX) {
  if (_topVendidos) return _topVendidos;

  const piezas = new Map();
  getVentas().forEach(v => {
    if (v.cancelada) return;
    // Lo devuelto se descuenta: si algo se regresó, no es de lo más vendido
    const signo = v.tipo === 'venta' ? 1 : v.tipo === 'devolucion' ? -1 : 0;
    if (!signo) return;
    (v.items || []).forEach(i => {
      if (!i.productoId) return;      // las ventas libres no tienen producto
      piezas.set(i.productoId, num(piezas.get(i.productoId)) + signo * num(i.cantidad));
    });
  });

  const activos = new Map(getProductos().filter(p => p.activo !== false).map(p => [p.id, p]));
  _topVendidos = [...piezas.entries()]
    .filter(([id, n]) => activos.has(id) && n > 0)   // fuera los borrados y los ya devueltos
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([id]) => activos.get(id));
  return _topVendidos;
}

/* --------------------------------------------------------- render tienda */
function renderPos() {
  renderCategorias();
  renderProductos();
  renderCarrito();
  renderResumenTurnoPos();
}

function renderCategorias() {
  const cont = document.getElementById('pos-categorias');
  if (!cont) return;
  const cats = categoriasDe();
  if (!POS.categoria || !cats.includes(POS.categoria)) POS.categoria = CAT_TOP;

  // Sin ventas todavía, "Más vendidos" abriría una pantalla en blanco:
  // el primer turno arranca en Todos y la pestaña se llena sola al vender.
  if (POS.categoria === CAT_TOP && !topVendidos().length) POS.categoria = 'todas';

  // El nombre viaja en data-cat, no dentro del onclick: una categoría con
  // apóstrofo ("Bebida's") rompería el código en línea.
  cont.innerHTML = cats.map(c => `
    <button class="chip ${c === POS.categoria ? 'activo' : ''} ${c === CAT_TOP ? 'destacado' : ''}" data-cat="${esc(c)}"
            onclick="filtrarCategoria(this.dataset.cat)">
      ${icono(iconoCategoria(c), 18)}<span>${etiquetaCategoria(c)}</span>
    </button>`).join('');
}

function etiquetaCategoria(c) {
  if (c === CAT_TOP) return 'Más vendidos';
  if (c === 'todas') return 'Todos';
  return esc(c);
}

function filtrarCategoria(cat) {
  POS.categoria = cat;
  renderCategorias();
  renderProductos();
}

function onBuscarProducto(valor) {
  POS.busqueda = String(valor || '').toLowerCase().trim();
  renderProductos();
}

/** Vuelve a la categoría que estaba seleccionada antes de buscar. */
function limpiarBusqueda() {
  POS.busqueda = '';
  const b = document.getElementById('pos-buscar');
  if (b) { b.value = ''; b.focus(); }
  renderProductos();
}

/** Enter en el buscador: si hay un único resultado (o un SKU exacto) lo agrega
 *  directo. Así funciona igual que un lector de código de barras. */
function onBuscarKey(ev) {
  // Los lectores en modo teclado cierran con Enter; algunos controladores
  // lo reportan distinto, así que se aceptan las variantes conocidas.
  const esEnter = ev.key === 'Enter' || ev.key === 'Return' || ev.keyCode === 13;
  if (!esEnter) return;
  ev.preventDefault();
  const q = POS.busqueda;
  if (!q) return;
  const activos = getProductos().filter(p => p.activo !== false);
  const exacto  = activos.find(p => String(p.sku || '').toLowerCase() === q);
  const lista   = exacto ? [exacto] : filtrarProductos(activos);
  if (lista.length === 1) {
    agregarAlCarrito(lista[0].id);
    ev.target.value = '';
    POS.busqueda = '';
    renderProductos();
  } else if (lista.length === 0) {
    toast('Ningún producto coincide con esa búsqueda.', 'warn');
  }
}

function filtrarProductos(base = getProductos().filter(p => p.activo !== false)) {
  const coincide = (p) =>
    `${p.nombre} ${p.sku || ''} ${p.categoria || ''}`.toLowerCase().includes(POS.busqueda);

  const alfabetico = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');

  // Buscar manda sobre la categoría: quien teclea un nombre o pasa el lector
  // quiere encontrar el producto esté donde esté, sin acordarse de en qué
  // pestaña se quedó. La categoría vuelve a filtrar al limpiar la búsqueda.
  if (POS.busqueda) return base.filter(coincide).sort(alfabetico);

  // Más vendidos va en su propio orden —el de las ventas—, no alfabético
  if (POS.categoria === CAT_TOP) return topVendidos();
  if (POS.categoria === 'todas') return [...base].sort(alfabetico);

  return base.filter(p => (p.categoria || 'General') === POS.categoria).sort(alfabetico);
}

function renderProductos() {
  const cont = document.getElementById('pos-productos');
  if (!cont) return;
  const todos = getProductos();

  if (!todos.length) {
    cont.innerHTML = `
      <div class="vacio">
        <div class="vacio-ico">${icono('paquete', 34)}</div>
        <h3>Aún no hay productos</h3>
        <p>Agrega tu catálogo para cobrar con un solo toque. También puedes vender sin catálogo con <strong>Venta libre</strong>.</p>
        <button class="btn btn-primary" onclick="irA('inventario')">Ir a Inventario</button>
      </div>`;
    return;
  }

  const lista = filtrarProductos();
  if (!lista.length) {
    cont.innerHTML = POS.categoria === CAT_TOP && !POS.busqueda
      ? `<div class="vacio"><div class="vacio-ico">${icono('estrella', 34)}</div><h3>Todavía sin ventas</h3>
         <p>Esta pestaña se llena sola: en cuanto cobres, aquí quedan a la mano los productos que más salen.</p>
         <button class="btn btn-primary" onclick="filtrarCategoria('todas')">Ver todo el catálogo</button></div>`
      : `<div class="vacio"><div class="vacio-ico">${icono('buscar', 34)}</div><h3>Sin coincidencias</h3>
         <p>Prueba con otro nombre, código o categoría.</p></div>`;
    return;
  }

  // Al buscar se ignora la categoría: conviene decirlo y dar la salida
  const aviso = POS.busqueda ? `
    <div class="busqueda-aviso">
      ${icono('buscar', 16)}
      <span><strong>${fmtNum(lista.length)}</strong> resultado(s) en todo el catálogo</span>
      <button class="link" onclick="limpiarBusqueda()">Limpiar búsqueda</button>
    </div>` : '';

  cont.innerHTML = aviso + lista.map(p => {
    const sinStock = p.controlaStock !== false && num(p.stock) <= 0;
    const bajo     = p.controlaStock !== false && num(p.stock) > 0 && num(p.stock) <= num(p.stockMin, CONFIG.stockMinDefault);
    return `
      <button class="producto ${sinStock ? 'agotado' : ''} ${fotoDe(p.id) ? 'con-foto' : ''}" onclick="agregarAlCarrito('${esc(p.id)}')"
              title="${esc(p.nombre)}${p.sku ? ' · ' + esc(p.sku) : ''}">
        ${fotoDe(p.id) ? `<img class="producto-foto" src="${fotoDe(p.id)}" alt="" loading="lazy"/>` : ''}
        <span class="producto-nom">${esc(p.nombre)}</span>
        <span class="producto-precio">${fmt(p.precio)}</span>
        ${p.controlaStock === false
          ? `<span class="producto-stock libre">Sin control de stock</span>`
          : `<span class="producto-stock ${sinStock ? 'cero' : bajo ? 'bajo' : ''}">${sinStock ? 'Agotado' : fmtNum(p.stock) + ' en existencia'}</span>`}
      </button>`;
  }).join('');
}

/* ========================================== EGRESOS DESDE EL MOSTRADOR ===
   Llega el de los refrescos y hay que pagarle: no se puede pedir al cajero
   que se salga al corte a capturarlo. Esto escribe en las MISMAS listas del
   turno que usa el corte (TURNO.proveedores, .servicios, …), así que no hay
   dos registros que después no cuadren.
   ====================================================================== */

const TIPOS_EGRESO = [
  { clave: 'proveedores',  label: 'Proveedor', ico: 'camion',  sug: 'proveedores',   ayuda: 'Coca-Cola, Sabritas, Bimbo…' },
  { clave: 'servicios',    label: 'Servicio',  ico: 'recibo',  sug: 'servicios',     ayuda: 'Luz, agua, internet, gas…' },
  { clave: 'honorarios',   label: 'Sueldo',    ico: 'persona', sug: 'honorarios',    ayuda: 'Pagos a personas.' },
  { clave: 'otrosEgresos', label: 'Otro',      ico: 'subir',   sug: 'otros-retiros', ayuda: 'Cualquier otra salida de la caja.' },
];

let EGRESO = null;   // { modo, tipo, origen, destino, desc, monto }

function abrirEgreso(modo = 'salida') {
  if (!exigirTurnoAbierto()) return;
  EGRESO = { modo, tipo: 'proveedores', origen: 'caja', destino: 'cartera', desc: '', monto: 0 };
  renderEgreso();
  abrirModal('modal-egreso');
}

function fijarModoEgreso(m) {
  if (!EGRESO) return;
  EGRESO.modo = m;
  EGRESO.desc = ''; EGRESO.monto = 0;
  setVal('egreso-desc', ''); setVal('egreso-monto', '');
  // Un traspaso nunca sale de la tarjeta: si venía elegida como origen de una
  // compra, se cambia a caja para no dejar seleccionada una opción inválida.
  if (m === 'traspaso' && EGRESO.origen === 'tc') EGRESO.origen = 'caja';
  renderEgreso();
}

function fijarTipoEgreso(t) { if (EGRESO) { EGRESO.tipo = t; renderEgreso(); } }
function fijarOrigenEgreso(c) {
  if (!EGRESO) return;
  EGRESO.origen = c;
  // Un traspaso a sí mismo no significa nada: se manda a otra cuenta
  if (EGRESO.modo === 'traspaso' && EGRESO.destino === c) {
    EGRESO.destino = Object.keys(CUENTAS).find(k => k !== c);
  }
  renderEgreso();
}
function fijarDestinoEgreso(c) {
  if (!EGRESO) return;
  EGRESO.destino = c;
  if (EGRESO.origen === c) EGRESO.origen = Object.keys(CUENTAS).find(k => k !== c);
  renderEgreso();
}
function fijarDescEgreso(v)  { if (EGRESO) { EGRESO.desc = v; validarEgreso(); } }
function fijarMontoEgreso(v) { if (EGRESO) { EGRESO.monto = Math.max(0, redondear(v)); validarEgreso(); } }

/** Los egresos de este turno, de los cuatro tipos, del más nuevo al más viejo. */
function egresosDelTurno() {
  const filas = [];
  TIPOS_EGRESO.forEach(t => {
    (TURNO[t.clave] || []).forEach((item, i) => {
      if (!item) return;
      filas.push({ ...item, tipo: t.clave, label: t.label, ico: t.ico, idx: i });
    });
  });
  return filas.sort((a, b) => String(b.hora || '').localeCompare(String(a.hora || '')));
}

/** Botones para elegir una cuenta. `excluir` acepta una clave o una lista. */
function botonesCuenta(activa, fn, excluir) {
  const fuera = new Set(Array.isArray(excluir) ? excluir : excluir ? [excluir] : []);
  return Object.entries(CUENTAS)
    .filter(([k]) => !fuera.has(k))
    .map(([k, cta]) => `
      <button class="metodo ${k === activa ? 'activo' : ''}" onclick="${fn}('${k}')">
        <span class="metodo-ico">${icono(cta.icono, 22)}</span><span>${cta.label}</span>
      </button>`).join('');
}

function renderEgreso() {
  if (!EGRESO) return;
  const esTraspaso = EGRESO.modo === 'traspaso';
  const t = TIPOS_EGRESO.find(x => x.clave === EGRESO.tipo) || TIPOS_EGRESO[0];

  setText('egreso-titulo', esTraspaso ? 'Mover dinero entre cuentas' : 'Salida de dinero');
  $$('#egreso-modos .chip').forEach(b => b.classList.toggle('activo', b.dataset.modo === EGRESO.modo));

  /* --- tipo de gasto: sólo para una salida --- */
  show('egreso-tipos-wrap', !esTraspaso, 'block');
  if (!esTraspaso) {
    setHTML('egreso-tipos', TIPOS_EGRESO.map(x => `
      <button class="metodo ${x.clave === EGRESO.tipo ? 'activo' : ''}" onclick="fijarTipoEgreso('${x.clave}')">
        <span class="metodo-ico">${icono(x.ico, 22)}</span><span>${x.label}</span>
      </button>`).join(''));
  }

  /* --- de qué cuenta sale, y en un traspaso a cuál entra ---
     La tarjeta de crédito sólo se ofrece como forma de PAGAR (origen de una
     compra, o destino de un traspaso): de una tarjeta no se saca efectivo,
     así que nunca es origen de un traspaso. */
  setText('egreso-origen-lbl', esTraspaso ? '¿De qué cuenta sale?' : '¿Cómo lo pagas?');
  setHTML('egreso-origen', botonesCuenta(EGRESO.origen, 'fijarOrigenEgreso',
    esTraspaso ? 'tc' : []));
  show('egreso-destino-wrap', esTraspaso, 'block');
  if (esTraspaso) {
    setHTML('egreso-destino', botonesCuenta(EGRESO.destino, 'fijarDestinoEgreso',
      [EGRESO.origen]));
  }

  const desc = document.getElementById('egreso-desc');
  if (desc) {
    if (esTraspaso) { desc.removeAttribute('list'); desc.placeholder = 'Ej. Depósito del día, retiro para cambio…'; }
    else { desc.setAttribute('list', `dl-${t.sug}`); desc.placeholder = t.ayuda; }
    if (document.activeElement !== desc) desc.value = EGRESO.desc;
  }
  setText('egreso-desc-lbl', esTraspaso ? '¿Por qué lo mueves? (opcional)' : '¿De qué fue?');
  const mon = document.getElementById('egreso-monto');
  if (mon && document.activeElement !== mon) mon.value = EGRESO.monto || '';
  setText('egreso-monto-lbl', esTraspaso ? '¿Cuánto vas a mover?' : '¿Cuánto salió?');

  /* --- lo ya registrado en el turno, para corregir sin salir del mostrador --- */
  const egresos = egresosDelTurno().map(e => ({
    clase: 'egreso', etiqueta: e.label, desc: e.desc, monto: e.monto, hora: e.hora,
    cuenta: CUENTAS[cuentaDeEgreso(e)].label,
    quitar: `quitarEgresoPos('${e.tipo}', ${e.idx})`,
  }));
  const traspasos = (TURNO.traspasos || []).map((t2, i) => ({
    clase: 'traspaso', etiqueta: 'Traspaso', desc: t2.desc, monto: t2.monto, hora: t2.hora,
    cuenta: `${CUENTAS[t2.origen]?.label || '?'} → ${CUENTAS[t2.destino]?.label || '?'}`,
    quitar: `quitarTraspaso(${i})`,
  }));
  const previos = [...egresos, ...traspasos]
    .sort((a, b) => String(b.hora || '').localeCompare(String(a.hora || '')));

  const porCuenta = egresosPorCuenta();
  setText('egreso-total-turno', fmt(totalEgresos()));
  setText('egreso-desglose',
    `Caja ${fmt(porCuenta.caja)} · Cartera ${fmt(porCuenta.cartera)} · MP ${fmt(porCuenta.mp)}` +
    (porCuenta.tc ? ` · ${CUENTAS.tc.label} ${fmt(porCuenta.tc)}` : ''));
  setHTML('egreso-lista', previos.length
    ? previos.map(e => `
        <div class="concepto-fila">
          <span class="pill ${e.clase === 'traspaso' ? 'pill-abono' : ''}">${esc(e.etiqueta)}</span>
          <span class="cf-desc">${esc(e.desc || 'Sin concepto')}
            <span class="hint">${esc(e.cuenta)}</span></span>
          <span class="mono">${fmt(e.monto)}</span>
          <button class="btn-icono peligro" title="Quitar" onclick="${e.quitar}">${icono('bote', 15)}</button>
        </div>`).join('')
    : `<p class="hint">Todavía no has registrado movimientos en este turno.</p>`);

  validarEgreso();
  pintarIconos(document.getElementById('modal-egreso'));
}

function validarEgreso() {
  const btn = document.getElementById('btn-guardar-egreso');
  const aviso = document.getElementById('egreso-aviso');
  if (!EGRESO) return;
  const esTraspaso = EGRESO.modo === 'traspaso';
  // En un traspaso el concepto es opcional: mover dinero se explica solo
  const falta = (!esTraspaso && !String(EGRESO.desc || '').trim()) ? 'concepto'
              : num(EGRESO.monto) <= 0 ? 'monto' : null;
  if (btn) {
    btn.disabled = !!falta;
    setText('btn-guardar-egreso-txt', esTraspaso ? 'Registrar traspaso' : 'Registrar salida');
  }
  if (aviso) {
    const oCta = CUENTAS[EGRESO.origen].label, dCta = CUENTAS[EGRESO.destino]?.label;
    const esCargoTC = !esTraspaso && EGRESO.origen === 'tc';
    aviso.innerHTML = falta === 'concepto'
        ? `<span class="pill pill-warn">Escribe de qué fue el pago</span>`
      : falta === 'monto'
        ? `<span class="pill pill-warn">Escribe el importe</span>`
      : esTraspaso
        ? `<span class="pill pill-ok">${fmt(EGRESO.monto)} de ${oCta} a ${dCta}</span>`
      : esCargoTC
        ? `<span class="pill pill-ok">Se carga a ${oCta}: ${fmt(EGRESO.monto)} · no sale efectivo</span>`
        : `<span class="pill pill-ok">Sale de ${oCta}: ${fmt(EGRESO.monto)}</span>`;
  }
}

function guardarEgreso() {
  if (!EGRESO) return;
  const desc  = String(EGRESO.desc || '').trim();
  const monto = redondear(EGRESO.monto);
  if (monto <= 0) { toast('Falta el importe.', 'error'); return; }

  if (EGRESO.modo === 'traspaso') {
    if (EGRESO.origen === EGRESO.destino) { toast('Elige dos cuentas distintas.', 'error'); return; }
    if (!Array.isArray(TURNO.traspasos)) TURNO.traspasos = [];
    TURNO.traspasos.push({
      id: nuevoId('trp'), origen: EGRESO.origen, destino: EGRESO.destino,
      monto, desc, hora: new Date().toISOString(),
    });
    guardarTurno();
    if (EGRESO.destino === 'tc') {
      toast(`${fmt(monto)} pagados a ${CUENTAS.tc.label} desde ${CUENTAS[EGRESO.origen].label}. Tu deuda baja.`, 'success', 5000);
    } else {
      toast(`${fmt(monto)} de ${CUENTAS[EGRESO.origen].label} a ${CUENTAS[EGRESO.destino].label}. ` +
            `El total de la tienda no cambia.`, 'success', 5000);
    }
  } else {
    if (!desc) { toast('Falta el concepto.', 'error'); return; }
    const clave = EGRESO.tipo;
    if (!Array.isArray(TURNO[clave])) TURNO[clave] = [];
    TURNO[clave].push({
      id: nuevoId('cp'), desc, monto, origen: EGRESO.origen, hora: new Date().toISOString(),
    });
    guardarTurno();
    addSugerencia(TIPOS_EGRESO.find(x => x.clave === clave).sug, desc);
    if (EGRESO.origen === 'tc') {
      toast(`Cargado ${fmt(monto)} a ${CUENTAS.tc.label}. No salió efectivo; sube lo que debes.`, 'success', 4500);
    } else {
      toast(`Salida de ${fmt(monto)} desde ${CUENTAS[EGRESO.origen].label}.`, 'success', 4500);
    }
  }

  // Listo para el siguiente movimiento sin cerrar el modal
  EGRESO = { ...EGRESO, desc: '', monto: 0 };
  const d = document.getElementById('egreso-desc'); if (d) d.value = '';
  const m = document.getElementById('egreso-monto'); if (m) m.value = '';
  renderEgreso();
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  if (VISTA === 'corte') renderCorte();     // el corte muestra los mismos datos
  respaldarPronto('egreso');
  if (d) d.focus();
}

async function quitarEgresoPos(clave, idx) {
  const item = (TURNO[clave] || [])[idx];
  if (!item) return;
  const cuenta = cuentaDeEgreso(item);
  const cta = CUENTAS[cuenta].label;
  const efecto = cuenta === 'tc'
    ? `Lo que debes en <strong>${cta}</strong> baja ese importe.`
    : `El saldo esperado de <strong>${cta}</strong> sube otra vez ese importe.`;
  const ok = await confirmar({
    titulo: 'Quitar la salida',
    mensaje: `Se elimina <strong>${esc(item.desc || 'sin concepto')}</strong> por ${fmt(item.monto)}.<br>${efecto}`,
    ok: 'Quitar', peligro: true,
  });
  if (!ok) return;
  TURNO[clave].splice(idx, 1);
  guardarTurno();
  renderEgreso();
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  toast('Salida eliminada.', 'info');
}

async function quitarTraspaso(idx) {
  const t = (TURNO.traspasos || [])[idx];
  if (!t) return;
  const ok = await confirmar({
    titulo: 'Quitar el traspaso',
    mensaje: `Se deshace el movimiento de <strong>${fmt(t.monto)}</strong> de
              ${CUENTAS[t.origen]?.label} a ${CUENTAS[t.destino]?.label}.`,
    ok: 'Quitar', peligro: true,
  });
  if (!ok) return;
  TURNO.traspasos.splice(idx, 1);
  guardarTurno();
  renderEgreso();
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  toast('Traspaso eliminado.', 'info');
}

/* ============================================================== TICKETS ===
   Varios clientes a la vez. Cada ticket ocupa un lugar fijo en la barra y no
   se mueve nunca: el que está activo sólo se resalta. Si las pestañas se
   reordenaran al cambiar de uno a otro, el cajero terminaría picando la que
   no era.

   El carrito vivo es POS.carrito; se vuelca a su ticket en cada render, y la
   lista completa vive en el turno para que aguante un cierre de ventana.
   ====================================================================== */

function listaTickets() {
  if (!Array.isArray(TURNO.tickets)) TURNO.tickets = [];

  // Formato anterior (ticketsPendientes): se convierte una sola vez
  if (Array.isArray(TURNO.ticketsPendientes) && TURNO.ticketsPendientes.length) {
    TURNO.ticketsPendientes.forEach(t => TURNO.tickets.push({
      id: t.id || nuevoId('tk'),
      carrito: Array.isArray(t.carrito) ? t.carrito : [],
      descuento: num(t.descuento),
      creado: t.creado || new Date().toISOString(),
    }));
    TURNO.ticketsPendientes = [];
  }

  // Siempre hay al menos uno: el que se está cobrando
  if (!TURNO.tickets.length) {
    TURNO.tickets.push({ id: nuevoId('tk'), carrito: [], descuento: 0, creado: new Date().toISOString() });
  }
  if (!TURNO.tickets.some(t => t.id === TURNO.ticketActivo)) {
    TURNO.ticketActivo = TURNO.tickets[0].id;
    POS.carrito   = TURNO.tickets[0].carrito;
    POS.descuento = num(TURNO.tickets[0].descuento);
  }
  return TURNO.tickets;
}

function ticketActivo() {
  const lista = listaTickets();
  return lista.find(t => t.id === TURNO.ticketActivo) || lista[0];
}

/** Vuelca el carrito vivo a su ticket. Se llama en cada render del carrito,
 *  que es por donde pasan todos los cambios. */
function sincronizarTicketActivo() {
  const t = ticketActivo();
  if (!t) return;
  t.carrito = POS.carrito;
  t.descuento = num(POS.descuento);
  guardarTurno();
}

/** Nombre corto para reconocerlo en la barra: el primer producto y cuántos más. */
function etiquetaTicket(carrito) {
  if (!carrito || !carrito.length) return 'Vacío';
  const primero = String(carrito[0].nombre || 'Artículo').split(' ').slice(0, 2).join(' ');
  const resto = carrito.length - 1;
  return resto > 0 ? `${primero} +${resto}` : primero;
}

function totalTicket(t) {
  return redondear((t.carrito || []).reduce((s, l) => s + num(l.precio) * num(l.cantidad), 0) - num(t.descuento));
}

/** Abre un ticket más. El anterior se queda donde estaba, con lo suyo. */
function nuevoTicket({ silencioso = false } = {}) {
  if (!exigirTurnoAbierto()) return null;
  const lista = listaTickets();
  sincronizarTicketActivo();

  // Si el actual está vacío no tiene sentido abrir otro igual
  const actual = ticketActivo();
  if (actual && !actual.carrito.length) {
    if (!silencioso) toast('Este ticket ya está vacío: úsalo para el siguiente cliente.', 'warn');
    return actual;
  }

  const t = { id: nuevoId('tk'), carrito: [], descuento: 0, creado: new Date().toISOString() };
  lista.push(t);                       // al final: los demás no se mueven
  TURNO.ticketActivo = t.id;
  POS.carrito = t.carrito;
  POS.descuento = 0;
  guardarTurno();
  renderCarrito();
  if (!silencioso) toast(`Ticket ${lista.length} abierto. El anterior sigue en la barra.`, 'success', 3500);
  return t;
}

/** Cambia de pestaña sin mover ninguna de su sitio. */
function cambiarATicket(id) {
  const lista = listaTickets();
  const t = lista.find(x => x.id === id);
  if (!t || t.id === TURNO.ticketActivo) return;

  sincronizarTicketActivo();
  TURNO.ticketActivo = t.id;
  POS.carrito = Array.isArray(t.carrito) ? t.carrito : [];
  POS.descuento = num(t.descuento);
  guardarTurno();
  renderCarrito();
}

async function descartarTicket(id) {
  const lista = listaTickets();
  const t = lista.find(x => x.id === id);
  if (!t) return;

  if (t.carrito.length) {
    const ok = await confirmar({
      titulo: 'Cerrar este ticket',
      mensaje: `Se perderá <strong>${esc(etiquetaTicket(t.carrito))}</strong> por ${fmt(totalTicket(t))}
                (${t.carrito.length} renglón(es)).`,
      ok: 'Cerrar ticket', peligro: true,
    });
    if (!ok) return;
  }
  quitarTicket(id);
  renderCarrito();
}

/** Saca un ticket de la lista y deja activo al vecino más cercano, para que
 *  el cajero no acabe en un ticket del otro extremo de la barra. */
function quitarTicket(id) {
  const lista = listaTickets();
  const i = lista.findIndex(x => x.id === id);
  if (i < 0) return;
  const eraActivo = lista[i].id === TURNO.ticketActivo;
  lista.splice(i, 1);

  if (!lista.length) {
    lista.push({ id: nuevoId('tk'), carrito: [], descuento: 0, creado: new Date().toISOString() });
  }
  if (eraActivo) {
    const siguiente = lista[Math.min(i, lista.length - 1)];
    TURNO.ticketActivo = siguiente.id;
    POS.carrito = Array.isArray(siguiente.carrito) ? siguiente.carrito : [];
    POS.descuento = num(siguiente.descuento);
  }
  guardarTurno();
}

/** Barra de pestañas. El orden es el de creación y no cambia nunca. */
function renderTickets() {
  const cont = document.getElementById('pos-tickets');
  if (!cont) return;
  const lista = listaTickets();

  cont.innerHTML = lista.map((t, i) => {
    const activo = t.id === TURNO.ticketActivo;
    const vacio  = !t.carrito.length;
    return `
      <span class="btn-ticket ${activo ? 'activo' : ''}" title="Abierto a las ${horaDe(t.creado)}">
        <button class="tk-retomar" ${activo ? 'disabled' : ''} onclick="cambiarATicket('${t.id}')">
          ${icono('ticket', 15)}
          <span>${i + 1}. ${vacio ? 'Vacío' : esc(etiquetaTicket(t.carrito))}</span>
          <b class="mono">${fmt(totalTicket(t))}</b>
        </button>
        ${lista.length > 1 || !vacio
          ? `<button class="tk-quitar" onclick="descartarTicket('${t.id}')" title="Cerrar este ticket">${icono('cerrar', 13)}</button>`
          : ''}
      </span>`;
  }).join('') + `
    <button class="btn-ticket nuevo" onclick="nuevoTicket()"
            title="Abre otro ticket sin perder este (F9)">
      ${icono('mas', 15)}<span>Nuevo</span>
    </button>`;

  cont.classList.toggle('con-tickets', lista.length > 1);
}

/* --------------------------------------------------------------- carrito */
/** ¿Se puede poner `cantidad` de este producto en el carrito?
 *
 *  Muchos catálogos traen productos que sí están en el anaquel pero con
 *  existencia 0 en el sistema. Bloquear la venta dejaría media tienda sin
 *  poder cobrarse, así que por defecto sólo se avisa y el inventario queda
 *  en negativo, que es justo la señal de "hay que recontar esto".
 *  Quien prefiera el candado lo activa en Ajustes.
 */
function hayExistencia(p, cantidad) {
  if (!p || p.controlaStock === false) return true;
  const hay = num(p.stock);
  if (cantidad <= hay) return true;

  const agotado = hay <= 0;
  const cuanto  = fmtNum(hay, hay % 1 ? 2 : 0);

  if (CONFIG.permitirSinStock === false) {
    toast(agotado
      ? `${p.nombre} está agotado. Registra la entrada en Inventario.`
      : `Sólo quedan ${cuanto} de ${p.nombre}.`, 'warn', 5000);
    return false;
  }

  toast(agotado
    ? `${p.nombre} aparece agotado en el sistema. Se vende igual y queda en negativo para que lo recuentes.`
    : `Quedan ${cuanto} de ${p.nombre} en el sistema. Se vende igual.`, 'warn', 5000);
  return true;
}

function agregarAlCarrito(productoId) {
  if (!exigirTurnoAbierto()) return;
  const p = buscarProducto(productoId);
  if (!p) { toast('Ese producto ya no existe.', 'error'); return; }

  const linea = POS.carrito.find(l => l.productoId === p.id && l.tipo === 'producto');
  const enCarrito = linea ? linea.cantidad : 0;

  if (!hayExistencia(p, enCarrito + 1)) return;

  if (linea) linea.cantidad = redondear(linea.cantidad + 1, 3);
  else POS.carrito.push({
    uid: nuevoId('ln'), productoId: p.id, nombre: p.nombre, sku: p.sku || '',
    precio: redondear(p.precio), cantidad: 1, tipo: 'producto',
  });

  renderCarrito();
}

function agregarLineaLibre() {
  if (!exigirTurnoAbierto()) return;
  const desc  = (document.getElementById('libre-desc')?.value || '').trim();
  const precio = num(document.getElementById('libre-precio')?.value, 0);
  const cant   = Math.max(1, num(document.getElementById('libre-cantidad')?.value, 1));
  if (precio <= 0) { toast('Escribe el importe de la venta.', 'error'); return; }

  POS.carrito.push({
    uid: nuevoId('ln'), productoId: null, nombre: desc || 'Venta varios', sku: '',
    precio: redondear(precio), cantidad: cant, tipo: 'libre',
  });
  if (desc) addSugerencia('venta-libre', desc);
  cerrarModal('modal-libre');
  renderCarrito();
  toast('Concepto agregado al carrito.', 'success', 2000);
}

function cambiarCantidad(uid, delta) {
  const l = POS.carrito.find(x => x.uid === uid);
  if (!l) return;
  const nueva = redondear(l.cantidad + delta, 3);
  if (nueva <= 0) { quitarLinea(uid); return; }

  if (l.tipo === 'producto' && delta > 0) {
    if (!hayExistencia(buscarProducto(l.productoId), nueva)) return;
  }
  l.cantidad = nueva;
  renderCarrito();
}

function fijarCantidad(uid, valor) {
  const l = POS.carrito.find(x => x.uid === uid);
  if (!l) return;
  const n = num(valor, 0);
  if (n <= 0) { quitarLinea(uid); return; }
  if (l.tipo === 'producto' && n > l.cantidad) {
    const p = buscarProducto(l.productoId);
    if (!hayExistencia(p, n)) {
      l.cantidad = Math.max(0, num(p.stock));   // se ajusta a lo disponible
      renderCarrito();
      return;
    }
  }
  l.cantidad = n;
  renderCarrito();
}

function fijarPrecioLinea(uid, valor) {
  const l = POS.carrito.find(x => x.uid === uid);
  if (!l) return;
  l.precio = Math.max(0, redondear(valor));
  renderCarrito();
}

function quitarLinea(uid) {
  POS.carrito = POS.carrito.filter(x => x.uid !== uid);
  renderCarrito();
}

async function vaciarCarrito(preguntar = true) {
  if (!POS.carrito.length) return;
  if (preguntar) {
    const ok = await confirmar({ titulo: 'Vaciar carrito', mensaje: '¿Quitar todos los productos del carrito?', ok: 'Vaciar', peligro: true });
    if (!ok) return;
  }
  POS.carrito = [];
  POS.descuento = 0;
  renderCarrito();
}

function totalesCarrito() {
  const subtotal  = redondear(POS.carrito.reduce((s, l) => s + l.precio * l.cantidad, 0));
  const descuento = clamp(POS.descuento, 0, subtotal);
  return { subtotal, descuento, total: redondear(subtotal - descuento) };
}

function renderCarrito() {
  const cont = document.getElementById('pos-carrito');
  if (!cont) return;
  setText('pos-folio', `Ticket #${folioEnCurso()}`);
  sincronizarTicketActivo();
  renderTickets();

  if (!POS.carrito.length) {
    cont.innerHTML = `<div class="carrito-vacio">
        <div class="vacio-ico">${icono('recibo', 34)}</div>
        <p>El carrito está vacío.<br>Toca un producto para empezar.</p>
      </div>`;
  } else {
    cont.innerHTML = POS.carrito.map(l => `
      <div class="linea">
        <div class="linea-info">
          <span class="linea-nom">${esc(l.nombre)}</span>
          <span class="linea-precio">
            <input class="input-mini js-calc" inputmode="decimal" value="${l.precio}"
                   onchange="fijarPrecioLinea('${l.uid}', this.value)" aria-label="Precio unitario"/>
            <span class="x">×</span>
          </span>
        </div>
        <div class="linea-cant">
          <button class="btn-cant" onclick="cambiarCantidad('${l.uid}', -1)" aria-label="Quitar uno">−</button>
          <input class="input-cant" inputmode="decimal" value="${l.cantidad}"
                 onchange="fijarCantidad('${l.uid}', this.value)" aria-label="Cantidad"/>
          <button class="btn-cant" onclick="cambiarCantidad('${l.uid}', 1)" aria-label="Agregar uno">+</button>
        </div>
        <div class="linea-importe">${fmt(l.precio * l.cantidad)}</div>
        <button class="linea-quitar" onclick="quitarLinea('${l.uid}')" aria-label="Quitar del carrito">✕</button>
      </div>`).join('');
  }

  const t = totalesCarrito();
  setText('pos-subtotal', fmt(t.subtotal));
  setText('pos-descuento-val', t.descuento > 0 ? '−' + fmt(t.descuento) : fmt(0));
  setText('pos-total', fmt(t.total));
  setText('pos-num-articulos', `${fmtNum(POS.carrito.reduce((s, l) => s + l.cantidad, 0), 0)} artículo(s)`);

  const btn = document.getElementById('btn-cobrar');
  if (btn) {
    btn.disabled = t.total <= 0;
    btn.innerHTML = t.total > 0 ? `Cobrar <strong>${fmt(t.total)}</strong>` : 'Cobrar';
  }
  const dsc = document.getElementById('pos-descuento-input');
  if (dsc && document.activeElement !== dsc) dsc.value = POS.descuento || '';
}

function aplicarDescuento(valor) {
  const { subtotal } = totalesCarrito();
  POS.descuento = clamp(num(valor), 0, subtotal);
  renderCarrito();
}

/* ------------------------------------------------------------ modal cobro */
function abrirCobro() {
  if (!exigirTurnoAbierto()) return;
  const t = totalesCarrito();
  if (t.total <= 0) { toast('Agrega algo al carrito antes de cobrar.', 'warn'); return; }

  POS.cobro = { tipo: 'venta', total: t.total, pagos: [{ metodo: 'efectivo', monto: t.total }], recibido: 0, cliente: '', mixto: false };
  renderCobro();
  abrirModal('modal-cobro');
  // Al cobrar, el cursor va al renglón que se escribe: con cuánto paga
  setTimeout(() => {
    const r = document.getElementById('cobro-recibido');
    if (r) { try { r.focus({ preventScroll: true }); } catch { r.focus(); } r.select(); }
  }, 90);
}

function abrirCobroAbono(cliente = '') {
  if (!exigirTurnoAbierto()) return;
  POS.cobro = { tipo: 'abono', total: 0, pagos: [{ metodo: 'efectivo', monto: 0 }], recibido: 0, cliente, mixto: false };
  // Si ya sabemos quién paga, el abono arranca con lo que debe
  if (cliente) {
    const saldo = saldoDe(cliente);
    if (saldo > 0) { POS.cobro.total = saldo; POS.cobro.pagos[0].monto = saldo; }
  }
  renderCobro();
  abrirModal('modal-cobro');
  const inp = document.querySelector('#cobro-cliente-wrap input');
  if (inp) inp.value = cliente;
}

function restanteCobro() {
  const c = POS.cobro;
  if (!c) return 0;
  const pagado = redondear(c.pagos.reduce((s, p) => s + num(p.monto), 0));
  return redondear(c.total - pagado);
}

/**
 * Un toque cambia la forma de pago completa: lo más común con mucho es
 * cobrar todo por una sola vía. Repartir entre varias es la excepción y vive
 * detrás del interruptor de pago mixto.
 */
function elegirMetodo(metodo) {
  const c = POS.cobro;
  if (!c) return;

  if (!c.mixto) {
    c.pagos = [{ metodo, monto: c.total }];
    // El efectivo recibido de una vía anterior ya no aplica
    if (metodo !== 'efectivo') c.recibido = 0;
    renderCobro();
    volverAlImporteCobro();   // el botón no se queda con el foco
    return;
  }

  // En mixto sí se suman y se quitan formas de pago
  const i = c.pagos.findIndex(p => p.metodo === metodo);
  if (i >= 0) {
    if (c.pagos.length === 1) { toast('Debe quedar al menos una forma de pago.', 'warn'); return; }
    c.pagos.splice(i, 1);
    const falta = restanteCobro();          // lo descubierto pasa al primero
    if (falta !== 0) c.pagos[0].monto = redondear(num(c.pagos[0].monto) + falta);
  } else {
    c.pagos.push({ metodo, monto: Math.max(0, restanteCobro()) });
  }
  renderCobro();
  volverAlImporteCobro();
}

/** Compatibilidad: algo viejo podría seguir llamando al nombre anterior. */
function alternarMetodo(metodo) { elegirMetodo(metodo); }

function alternarMixto() {
  const c = POS.cobro;
  if (!c) return;
  c.mixto = !c.mixto;
  if (!c.mixto) {
    // Al volver a pago simple mandamos el método que traía más dinero
    const principal = [...c.pagos].sort((a, b) => num(b.monto) - num(a.monto))[0];
    c.pagos = [{ metodo: principal ? principal.metodo : 'efectivo', monto: c.total }];
  }
  renderCobro();
  volverAlImporteCobro();
}

function fijarMontoPago(metodo, valor) {
  const c = POS.cobro;
  if (!c) return;
  const p = c.pagos.find(x => x.metodo === metodo);
  if (!p) return;
  p.monto = Math.max(0, redondear(valor));
  renderCobro();
}

function fijarTotalAbono(valor) {
  const c = POS.cobro;
  if (!c || c.tipo !== 'abono') return;
  c.total = Math.max(0, redondear(valor));
  if (c.pagos.length === 1) c.pagos[0].monto = c.total;
  renderCobro();
}

function fijarRecibido(valor) {
  if (!POS.cobro) return;
  POS.cobro.recibido = Math.max(0, redondear(valor));
  renderCobro();
}

/**
 * Devuelve el cursor al campo del importe.
 *
 * Los botones de billetes se quedaban con el foco, así que el Enter siguiente
 * volvía a picar el mismo botón en vez de cobrar: sumabas $20 de más sin
 * querer. Con el foco en el importe, Enter cobra y se puede seguir sumando.
 */
function volverAlImporteCobro() {
  const r = document.getElementById('cobro-recibido');
  if (r && r.offsetParent !== null) {
    try { r.focus({ preventScroll: true }); } catch { r.focus(); }
    // El cursor al final, para poder seguir tecleando
    const n = r.value.length;
    try { r.setSelectionRange(n, n); } catch { /* algunos navegadores no dejan */ }
    return;
  }
  // Sin efectivo de por medio (tarjeta, transferencia) no hay importe que
  // escribir: el foco va al botón de cobrar, para que Enter cierre la venta.
  const btn = document.getElementById('btn-confirmar-cobro');
  if (btn && !btn.disabled) { try { btn.focus({ preventScroll: true }); } catch { btn.focus(); } }
}

function sumarRecibido(monto) {
  if (!POS.cobro) return;
  POS.cobro.recibido = redondear(num(POS.cobro.recibido) + num(monto));
  renderCobro();
  volverAlImporteCobro();
}

function recibidoExacto() {
  if (!POS.cobro) return;
  const efe = POS.cobro.pagos.find(p => p.metodo === 'efectivo');
  POS.cobro.recibido = efe ? num(efe.monto) : 0;
  renderCobro();
  volverAlImporteCobro();
}

function renderCobro() {
  const c = POS.cobro;
  if (!c) return;

  setText('cobro-titulo', c.tipo === 'abono' ? 'Cobrar abono a cuenta' : 'Cobrar venta');
  show('cobro-abono-monto', c.tipo === 'abono', 'block');
  setText('cobro-total', fmt(c.total));

  /* botones de método */
  const cont = document.getElementById('cobro-metodos');
  if (cont) {
    cont.innerHTML = Object.entries(METODOS_PAGO).map(([k, m]) => {
      const activo = c.pagos.some(p => p.metodo === k);
      // Un abono a cuenta no puede pagarse "a crédito"
      if (c.tipo === 'abono' && k === 'credito') return '';
      return `<button class="metodo ${activo ? 'activo' : ''}" onclick="elegirMetodo('${k}')">
                <span class="metodo-ico">${icono(m.icono, 22)}</span><span>${m.label}</span>
              </button>`;
    }).join('');
  }

  /* interruptor de pago mixto */
  const swMixto = document.getElementById('cobro-mixto');
  if (swMixto) {
    swMixto.classList.toggle('activo', !!c.mixto);
    swMixto.innerHTML = `${icono(c.mixto ? 'palomita' : 'mas', 15)}
      <span>${c.mixto ? 'Pago dividido entre varias formas' : 'Dividir el pago en dos o más formas'}</span>`;
  }

  /* montos por método (sólo en pago mixto) */
  const desglose = document.getElementById('cobro-desglose');
  if (desglose) {
    if (c.mixto) {
      desglose.style.display = 'block';
      desglose.innerHTML = `<div class="campo-lbl">Reparto del pago</div>` +
        (c.pagos.length < 2 ? `<p class="hint">Toca arriba otra forma de pago para repartir el cobro.</p>` : '') +
        c.pagos.map(p => `
        <div class="cobro-row">
          <label>${icono(METODOS_PAGO[p.metodo].icono, 16)}${METODOS_PAGO[p.metodo].label}</label>
          <input class="input js-calc mono" inputmode="decimal" value="${p.monto}"
                 onchange="fijarMontoPago('${p.metodo}', this.value)"/>
        </div>`).join('');
    } else {
      desglose.style.display = 'none';
      desglose.innerHTML = '';
    }
  }

  /* efectivo: recibido y cambio */
  const efe = c.pagos.find(p => p.metodo === 'efectivo');
  show('cobro-efectivo', !!efe, 'block');
  let cambio = 0, faltaEfectivo = false;
  if (efe) {
    cambio = redondear(num(c.recibido) - num(efe.monto));
    faltaEfectivo = num(c.recibido) > 0 && cambio < 0;
    const inp = document.getElementById('cobro-recibido');
    if (inp && document.activeElement !== inp) inp.value = c.recibido || '';
    const elCambio = document.getElementById('cobro-cambio');
    if (elCambio) {
      elCambio.textContent = num(c.recibido) > 0 ? fmt(Math.max(0, cambio)) : '—';
      elCambio.className = 'cambio-val ' + (faltaEfectivo ? 'malo' : cambio > 0 ? 'bueno' : '');
    }
    setText('cobro-cambio-nota', faltaEfectivo
      ? `Faltan ${fmt(Math.abs(cambio))} para completar el pago en efectivo.`
      : 'Cambio a entregar al cliente');
  }

  /* Cliente: obligatorio si algo queda a crédito, y también en un abono
     (sin nombre no hay a qué cuenta aplicarlo). */
  const hayCredito = c.pagos.some(p => p.metodo === 'credito' && num(p.monto) > 0);
  const esAbono    = c.tipo === 'abono';
  const pideNombre = hayCredito || esAbono;
  const nombre     = String(c.cliente || '').trim();
  show('cobro-cliente-wrap', pideNombre, 'block');
  setText('cobro-cliente-lbl', esAbono ? '¿Quién está abonando?' : '¿Quién se lleva fiado?');

  /* Cuánto debe ya esta persona: se ve antes de cerrar el cobro */
  const elDeuda = document.getElementById('cobro-deuda');
  if (elDeuda) {
    const saldo = nombre ? saldoDe(nombre) : 0;
    // Un abono baja la deuda; lo que se lleva fiado la sube
    const credito   = num(c.pagos.find(p => p.metodo === 'credito')?.monto || 0);
    const quedaria  = redondear(esAbono ? saldo - num(c.total) : saldo + credito);
    const comoQueda = quedaria > 0.005  ? `quedaría debiendo <strong>${fmt(quedaria)}</strong>`
                    : quedaria < -0.005 ? `le quedarían <strong>${fmt(-quedaria)}</strong> a favor`
                    : `su cuenta queda <strong>saldada</strong>`;

    elDeuda.style.display = nombre ? 'block' : 'none';
    if (!nombre) { elDeuda.innerHTML = ''; }
    else if (Math.abs(saldo) <= 0.005) {
      elDeuda.innerHTML = `<span class="hint">No debía nada · ${comoQueda}.</span>`;
    } else if (saldo > 0) {
      elDeuda.innerHTML = `Debe <strong>${fmt(saldo)}</strong> · ${comoQueda}.
        ${esAbono && !igualDinero(num(c.total), saldo)
          ? ` <button class="btn btn-ghost compacto" onclick="fijarTotalAbono(${saldo})">Abonar todo</button>` : ''}`;
    } else {
      elDeuda.innerHTML = `<span class="hint">Tiene ${fmt(-saldo)} a favor · ${comoQueda}.</span>`;
    }
  }

  /* estado general */
  const falta = restanteCobro();
  const aviso = document.getElementById('cobro-aviso');
  const btn   = document.getElementById('btn-confirmar-cobro');
  let listo = c.total > 0 && igualDinero(falta, 0) && !faltaEfectivo;
  if (pideNombre && !nombre) listo = false;

  if (aviso) {
    if (c.total <= 0)               aviso.innerHTML = `<span class="pill pill-warn">Escribe el monto a cobrar</span>`;
    else if (!igualDinero(falta, 0)) aviso.innerHTML = `<span class="pill pill-warn">${falta > 0 ? `Faltan ${fmt(falta)} por asignar` : `Sobran ${fmt(-falta)} en el reparto`}</span>`;
    else if (faltaEfectivo)          aviso.innerHTML = `<span class="pill pill-warn">El efectivo recibido no alcanza</span>`;
    else if (pideNombre && !nombre)  aviso.innerHTML = `<span class="pill pill-warn">${esAbono ? 'Escribe de quién es el abono' : 'Escribe el nombre del cliente que se lleva fiado'}</span>`;
    else                             aviso.innerHTML = `<span class="pill pill-ok">Listo para cobrar</span>`;
  }
  if (btn) btn.disabled = !listo;
}

function fijarCliente(valor) {
  if (POS.cobro) POS.cobro.cliente = valor;
  renderCobro();
}

/* ------------------------------------------------------- confirmar venta */
function confirmarCobro() {
  const c = POS.cobro;
  if (!c) return;
  if (!igualDinero(restanteCobro(), 0) || c.total <= 0) { toast('Revisa el reparto del pago.', 'error'); return; }

  const pagos = c.pagos.filter(p => num(p.monto) > 0)
    .map(p => ({ metodo: p.metodo, monto: redondear(p.monto) }));
  if (!pagos.length) { toast('Registra al menos una forma de pago.', 'error'); return; }

  const efe = pagos.find(p => p.metodo === 'efectivo');
  const t   = totalesCarrito();

  const venta = {
    id: nuevoId('vta'),
    folio: siguienteFolio(),
    tipo: c.tipo,                        // 'venta' | 'abono'
    turnoId: TURNO.id,
    cajero: TURNO.cajero,
    fecha: TURNO.fecha || hoyISO(),
    fechaHora: new Date().toISOString(),
    items: c.tipo === 'venta'
      ? POS.carrito.map(l => {
          // El costo se congela al vender: si mañana sube, la ganancia de
          // ayer no debe cambiar sola en los reportes.
          const p = l.productoId ? buscarProducto(l.productoId) : null;
          return {
            productoId: l.productoId, nombre: l.nombre, sku: l.sku,
            precio: redondear(l.precio), cantidad: redondear(l.cantidad, 3),
            importe: redondear(l.precio * l.cantidad), tipo: l.tipo,
            costo: p ? redondear(num(p.costo)) : 0,
          };
        })
      : [{ productoId: null, nombre: 'Abono a cuenta', sku: '', precio: c.total, cantidad: 1, importe: c.total, tipo: 'abono' }],
    subtotal:  c.tipo === 'venta' ? t.subtotal  : c.total,
    descuento: c.tipo === 'venta' ? t.descuento : 0,
    total: redondear(c.total),
    pagos,
    recibido: efe ? redondear(c.recibido) : 0,
    cambio:   efe ? Math.max(0, redondear(num(c.recibido) - num(efe.monto))) : 0,
    cliente: String(c.cliente || '').trim(),
    cancelada: false,
  };

  // Descontar inventario (sólo ventas de productos con control de stock)
  if (venta.tipo === 'venta') aplicarStock(venta.items, -1);
  if (venta.cliente) addSugerencia('clientes', venta.cliente);

  const ventas = getVentas();
  ventas.unshift(venta);
  setVentas(ventas);

  POS.ultimaVenta = venta;
  POS.cobro = null;

  // El ticket cobrado se cierra y su pestaña desaparece; los demás no se
  // mueven. Si era el único, se reutiliza vacío para el siguiente cliente.
  if (listaTickets().length > 1) {
    quitarTicket(TURNO.ticketActivo);
  } else {
    POS.carrito = [];
    POS.descuento = 0;
  }

  cerrarModal('modal-cobro');
  renderCarrito();
  renderProductos();
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  respaldarPronto('venta');

  if (venta.cambio > 0) toast(`Cobrado ${fmt(venta.total)} · Cambio ${fmt(venta.cambio)}`, 'success', 5000);
  else toast(`Cobrado ${fmt(venta.total)}`, 'success');

  mostrarTicket(venta);
}

/** Suma (signo +1) o descuenta (−1) del inventario los artículos de una venta. */
function aplicarStock(items, signo) {
  const productos = getProductos();
  let cambio = false;
  const bajos = [];
  (items || []).forEach(it => {
    if (!it.productoId) return;
    const p = productos.find(x => x.id === it.productoId);
    if (!p || p.controlaStock === false) return;
    p.stock = redondear(num(p.stock) + signo * num(it.cantidad), 3);
    cambio = true;
    if (signo < 0 && p.stock <= num(p.stockMin, CONFIG.stockMinDefault)) bajos.push(p);
  });
  if (cambio) setProductos(productos);
  if (bajos.length) {
    const nombres = bajos.slice(0, 3).map(p => `${p.nombre} (${fmtNum(p.stock)})`).join(', ');
    toast(`Existencias bajas: ${nombres}${bajos.length > 3 ? '…' : ''}`, 'warn', 6000);
  }
}

/* -------------------------------------------------------------- recargas */
function abrirRecarga() {
  if (!exigirTurnoAbierto()) return;
  setVal('recarga-monto', '');
  setVal('recarga-desc', '');
  actualizarPreviewRecarga();
  abrirModal('modal-recarga');
}

/* ============================================== ENVÍO DE DINERO ==========
   El cliente quiere mandar dinero: tú lo transfieres desde tu cuenta y él te
   paga en efectivo el monto más tu comisión. El dinero no se pierde, cambia
   de lugar; lo único que ganas es la comisión.
   ====================================================================== */

let ENVIO = null;   // { monto, comision, cuenta, desc }

function abrirEnvio() {
  if (!exigirTurnoAbierto()) return;
  ENVIO = { monto: 0, comision: num(CONFIG.comisionEnvio, 15), cuenta: 'mp', desc: '' };
  setVal('envio-monto', '');
  setVal('envio-comision', ENVIO.comision);
  setVal('envio-desc', '');
  renderEnvio();
  abrirModal('modal-envio');
}

function fijarMontoEnvio(v)    { if (ENVIO) { ENVIO.monto = Math.max(0, redondear(v)); renderEnvio(); } }
function fijarComisionEnvio(v) { if (ENVIO) { ENVIO.comision = Math.max(0, redondear(v)); renderEnvio(); } }
function fijarCuentaEnvio(c)   { if (ENVIO) { ENVIO.cuenta = c; renderEnvio(); } }
function fijarDescEnvio(v)     { if (ENVIO) { ENVIO.desc = v; } }

function renderEnvio() {
  if (!ENVIO) return;
  const total = redondear(num(ENVIO.monto) + num(ENVIO.comision));

  setHTML('envio-cuentas', Object.entries(CUENTAS)
    .filter(([k]) => k !== 'caja')       // el efectivo lo recibes, no lo transfieres
    .map(([k, cta]) => `
      <button class="metodo ${k === ENVIO.cuenta ? 'activo' : ''}" onclick="fijarCuentaEnvio('${k}')">
        <span class="metodo-ico">${icono(cta.icono, 22)}</span><span>${cta.label}</span>
      </button>`).join(''));

  setText('envio-cobrar', fmt(total));
  setText('envio-sale', fmt(ENVIO.monto));
  setText('envio-ganas', fmt(ENVIO.comision));
  setText('envio-cuenta-nombre', CUENTAS[ENVIO.cuenta].largo);

  const btn = document.getElementById('btn-guardar-envio');
  if (btn) btn.disabled = num(ENVIO.monto) <= 0;
  const aviso = document.getElementById('envio-aviso');
  if (aviso) {
    aviso.innerHTML = num(ENVIO.monto) <= 0
      ? `<span class="pill pill-warn">Escribe cuánto vas a transferir</span>`
      : `<span class="pill pill-ok">Te da ${fmt(total)} en efectivo · ganas ${fmt(ENVIO.comision)}</span>`;
  }
  pintarIconos(document.getElementById('modal-envio'));
}

function registrarEnvio() {
  if (!ENVIO) return;
  const monto = redondear(ENVIO.monto);
  const comision = redondear(ENVIO.comision);
  if (monto <= 0) { toast('Escribe el monto a transferir.', 'error'); return; }
  const total = redondear(monto + comision);
  const desc = String(ENVIO.desc || '').trim();

  const venta = {
    id: nuevoId('env'), folio: siguienteFolio(), tipo: 'envio',
    turnoId: TURNO.id, cajero: TURNO.cajero,
    fecha: TURNO.fecha || hoyISO(), fechaHora: new Date().toISOString(),
    montoEnviado: monto, comision, cuentaOrigen: ENVIO.cuenta,
    items: [
      { productoId: null, nombre: `Envío de dinero${desc ? ' · ' + desc : ''}`, sku: '',
        precio: monto, cantidad: 1, importe: monto, tipo: 'envio' },
      { productoId: null, nombre: 'Comisión por el servicio', sku: '',
        precio: comision, cantidad: 1, importe: comision, tipo: 'comision' },
    ],
    subtotal: total, descuento: 0, total,
    pagos: [{ metodo: 'efectivo', monto: total }],   // el cliente siempre paga en efectivo
    recibido: total, cambio: 0, cliente: desc, cancelada: false,
  };

  const ventas = getVentas();
  ventas.unshift(venta);
  setVentas(ventas);
  if (desc) addSugerencia('clientes', desc);
  // La comisión que uses queda como la próxima propuesta
  if (comision !== num(CONFIG.comisionEnvio)) saveConfig({ comisionEnvio: comision });

  ENVIO = null;
  cerrarModal('modal-envio');
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  respaldarPronto('envio');
  toast(`Envío de ${fmt(monto)} desde ${CUENTAS[venta.cuentaOrigen].label}. ` +
        `Cobra ${fmt(total)} en efectivo.`, 'success', 6000);
  mostrarTicket(venta);
}

function actualizarPreviewRecarga() {
  const monto = valOf('recarga-monto', 0);
  const com   = comisionPorRecargas(monto);
  setText('recarga-comision', fmt(com));
  setText('recarga-neto', fmt(monto - com));
  setText('recarga-efectivo', fmt(monto));
}

function registrarRecarga() {
  const monto = valOf('recarga-monto', 0);
  const desc  = (document.getElementById('recarga-desc')?.value || '').trim();
  if (monto <= 0) { toast('Escribe el monto de la recarga.', 'error'); return; }

  const venta = {
    id: nuevoId('rec'), folio: siguienteFolio(), tipo: 'recarga',
    turnoId: TURNO.id, cajero: TURNO.cajero,
    fecha: TURNO.fecha || hoyISO(), fechaHora: new Date().toISOString(),
    items: [{ productoId: null, nombre: desc || 'Recarga de tiempo aire', sku: '', precio: monto, cantidad: 1, importe: monto, tipo: 'recarga' }],
    subtotal: monto, descuento: 0, total: monto,
    pagos: [{ metodo: 'efectivo', monto }],   // el cliente siempre paga en efectivo
    recibido: monto, cambio: 0, cliente: '', cancelada: false,
  };

  const ventas = getVentas();
  ventas.unshift(venta);
  setVentas(ventas);
  if (desc) addSugerencia('recargas', desc);

  cerrarModal('modal-recarga');
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  respaldarPronto('recarga');
  toast(`Recarga de ${fmt(monto)} registrada.`, 'success');
}

/* --------------------------------------------------------------- ticket */
function mostrarTicket(venta) {
  const cont = document.getElementById('ticket-contenido');
  if (!cont) return;
  cont.innerHTML = ticketHTML(venta);
  abrirModal('modal-ticket');
}

function ticketHTML(v) {
  const filas = (v.items || []).map(i => `
    <tr>
      <td>${fmtNum(i.cantidad, num(i.cantidad) % 1 ? 2 : 0)}</td>
      <td>${esc(i.nombre)}</td>
      <td class="der">${fmt(i.importe)}</td>
    </tr>`).join('');

  const pagos = (v.pagos || []).map(p =>
    `<div class="tk-row"><span>${METODOS_PAGO[p.metodo]?.label || p.metodo}</span><span>${fmt(p.monto)}</span></div>`).join('');

  return `
    <div class="ticket" id="ticket-imprimible">
      <div class="tk-head">
        <strong>${esc(CONFIG.negocio)}</strong>
        <span>${v.tipo === 'recarga' ? 'Comprobante de recarga' : v.tipo === 'abono' ? 'Comprobante de abono' : v.tipo === 'envio' ? 'Comprobante de envío' : v.tipo === 'saldoInicial' ? 'Deuda registrada' : 'Nota de venta'}</span>
        <span>Folio ${v.folio} · ${fechaHoraCorta(v.fechaHora)}</span>
        <span>Atendió: ${esc(v.cajero || '')}</span>
      </div>
      <table class="tk-tabla">
        <thead><tr><th>Cant</th><th>Descripción</th><th class="der">Importe</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="tk-tot">
        ${num(v.descuento) > 0 ? `<div class="tk-row"><span>Subtotal</span><span>${fmt(v.subtotal)}</span></div>
        <div class="tk-row"><span>Descuento</span><span>−${fmt(v.descuento)}</span></div>` : ''}
        <div class="tk-row tk-total"><span>TOTAL</span><span>${fmt(v.total)}</span></div>
        ${pagos}
        ${num(v.recibido) > 0 ? `<div class="tk-row"><span>Recibido</span><span>${fmt(v.recibido)}</span></div>
        <div class="tk-row"><span>Cambio</span><span>${fmt(v.cambio)}</span></div>` : ''}
        ${v.cliente ? `<div class="tk-row"><span>Cliente</span><span>${esc(v.cliente)}</span></div>` : ''}
      </div>
      <div class="tk-pie">${esc(CONFIG.ticketPie || '')}</div>
    </div>`;
}

function imprimirTicket() {
  document.body.classList.add('imprimiendo-ticket');
  window.print();
  setTimeout(() => document.body.classList.remove('imprimiendo-ticket'), 800);
}

/* ------------------------------------------------- ventas del turno (POS) */
function renderResumenTurnoPos() {
  const t = totalesPos();
  setText('pos-turno-ventas',    fmtNum(t.numVentas));
  setText('pos-turno-total',     fmt(t.totalVendido));
  setText('pos-turno-efectivo',  fmt(t.efectivo));
  setText('pos-turno-digital',   fmt(t.tarjeta + t.transferencia));
  setText('pos-turno-fiado',     fmt(t.credito));
  setText('pos-turno-recargas',  fmt(t.recargas));
  setText('pos-turno-egresos',   fmt(totalEgresos()));
  setText('pos-turno-enviado',   fmt(t.enviado));
  renderListaVentas();
}

/* Cuántos movimientos se dibujan de una vez. Un turno movido pasa de 500, y
   cada renglón son ~30 nodos: dibujarlos todos llenaba la página de 15 mil
   nodos para una lista que casi siempre está cerrada. */
const MOVS_VISIBLES = 60;

/** Abre la lista de movimientos y la arma en ese momento, no antes. */
function abrirMovimientos() {
  abrirModal('modal-movimientos');
  renderListaVentas();
}

/** Al cerrarla se vacía: no tiene sentido dejar cientos de nodos en memoria. */
function cerrarMovimientos() {
  const cont = document.getElementById('pos-lista-ventas');
  if (cont) { cont.innerHTML = ''; cont.dataset.pendiente = '1'; }
  cerrarModal('modal-movimientos');
}

function renderListaVentas() {
  const cont = document.getElementById('pos-lista-ventas');
  if (!cont) return;

  /* Sólo se arma si el modal está abierto. Antes se reconstruía en cada
     venta aunque nadie lo estuviera viendo: era el 89% del DOM de la app. */
  const modal = document.getElementById('modal-movimientos');
  if (!modal || !modal.classList.contains('visible')) {
    cont.dataset.pendiente = '1';    // se dibuja al abrirlo
    return;
  }
  delete cont.dataset.pendiente;

  const todas  = getVentas().filter(v => v.turnoId === TURNO.id);
  const ventas = todas.slice(0, MOVS_VISIBLES);

  if (!todas.length) {
    cont.innerHTML = `<div class="vacio pequeno"><p>Todavía no hay movimientos en este turno.</p></div>`;
    return;
  }

  const aviso = todas.length > ventas.length
    ? `<p class="hint">Mostrando los ${ventas.length} más recientes de ${fmtNum(todas.length)}.
       Para ver el resto usa <strong>Consultar ticket</strong>.</p>`
    : '';

  cont.innerHTML = aviso + ventas.map(v => {
    const etiqueta = v.tipo === 'recarga' ? 'Recarga' : v.tipo === 'abono' ? 'Abono'
                   : v.tipo === 'devolucion' ? 'Devolución' : 'Venta';
    const metodos  = (v.pagos || []).map(p => icono(METODOS_PAGO[p.metodo]?.icono, 15)).join('');
    return `
      <div class="venta-item ${v.cancelada ? 'cancelada' : ''}">
        <div class="venta-main">
          <span class="venta-tag">${etiqueta}</span>
          <span class="venta-folio">#${v.folio}</span>
          <span class="venta-hora">${horaDe(v.fechaHora)}</span>
          ${v.cancelada ? '<span class="pill pill-off">Cancelada</span>' : ''}
        </div>
        <div class="venta-desc">${esc((v.items || []).map(i => `${i.cantidad}× ${i.nombre}`).join(', ')).slice(0, 90)}</div>
        <div class="venta-lado">
          <span class="venta-metodos">${metodos}</span>
          <span class="venta-total">${fmt(v.total)}</span>
          <button class="btn-icono" title="Ver ticket" onclick="verTicketVenta('${v.id}')">${icono('recibo')}</button>
          ${v.cancelada ? '' : (v.tipo === 'venta'
            ? `<button class="btn-icono" title="Devolución: el cliente regresa mercancía"
                       onclick="abrirDevolucion('${v.id}')">${icono('regresar')}</button>
               <button class="btn-icono" title="Corregir: anula y vuelve al carrito"
                       onclick="corregirVenta('${v.id}')">${icono('lapiz')}</button>` : '')}
          ${v.cancelada ? '' : `<button class="btn-icono peligro" title="Cancelar movimiento"
                     onclick="cancelarVenta('${v.id}')">${icono('cerrar')}</button>`}
        </div>
      </div>`;
  }).join('');
}

function verTicketVenta(id) {
  const v = getVentas().find(x => x.id === id);
  if (v) mostrarTicket(v);
}

async function cancelarVenta(id) {
  const ventas = getVentas();
  const v = ventas.find(x => x.id === id);
  if (!v || v.cancelada) return;

  const ok = await confirmar({
    titulo: 'Cancelar movimiento',
    mensaje: `Se cancelará el folio <strong>#${v.folio}</strong> por ${fmt(v.total)}.` +
             (v.tipo === 'venta' ? '<br>Los productos regresan al inventario.' : '') +
             '<br>El movimiento queda registrado como cancelado, no se borra.',
    ok: 'Cancelar movimiento', peligro: true,
  });
  if (!ok) return;

  v.cancelada = true;
  v.canceladaEn = new Date().toISOString();
  if (v.tipo === 'venta') aplicarStock(v.items, +1);
  setVentas(ventas);

  renderResumenTurnoPos();
  renderProductos();
  actualizarEstadoGlobal();
  respaldarPronto('cancelacion');
  toast(`Folio #${v.folio} cancelado.`, 'info');
}

/* ==================================================== DEVOLUCIONES =====
   Una venta cerrada no se toca: la devolución es un movimiento nuevo que
   apunta a ella. Así el historial conserva qué se vendió y qué se regresó,
   y el corte puede explicar la diferencia.
   ====================================================================== */

let DEVOL = null;   // { venta, lineas, metodo }

/* --- buscador de ventas: por aquí se llega a una devolución sin tener que
       acordarse de en qué lista estaba el ticket --- */
function abrirBuscarVenta() {
  if (!exigirTurnoAbierto()) return;
  setVal('bv-buscar', '');
  renderBuscarVenta();
  abrirModal('modal-buscar-venta');
}

function renderBuscarVenta() {
  const cont = document.getElementById('bv-lista');
  if (!cont) return;
  const q = (document.getElementById('bv-buscar')?.value || '').toLowerCase().trim();

  const candidatas = getVentas()
    .filter(v => v.tipo === 'venta' && !v.cancelada)
    .filter(v => {
      if (!q) return true;
      const texto = `${v.folio} ${v.cliente || ''} ${(v.items || []).map(i => `${i.nombre} ${i.sku || ''}`).join(' ')}`;
      return texto.toLowerCase().includes(q);
    })
    .slice(0, 60);

  if (!candidatas.length) {
    cont.innerHTML = `<div class="vacio pequeno"><div class="vacio-ico">${icono('buscar', 30)}</div>
      <p>${q ? 'Ninguna venta coincide con esa búsqueda.' : 'Todavía no hay ventas que devolver.'}</p></div>`;
    return;
  }

  cont.innerHTML = candidatas.map(v => {
    const ya = devueltoDe(v.id);
    const pendientes = (v.items || []).reduce((s, it, i) => s + (num(it.cantidad) - num(ya.get(i))), 0);
    const completa = pendientes <= 0;
    return `
      <div class="bv-fila ${completa ? 'agotada' : ''}">
        <div class="bv-info">
          <div class="bv-cab">
            <strong>#${v.folio}</strong>
            <span class="hint">${fechaCorta(v.fecha)} · ${horaDe(v.fechaHora)} · ${esc(v.cajero || '')}</span>
            ${completa ? '<span class="pill pill-off">Ya devuelta</span>' : ''}
          </div>
          <span class="bv-detalle">${esc((v.items || []).map(i =>
            `${fmtNum(i.cantidad, num(i.cantidad) % 1 ? 2 : 0)}× ${i.nombre}`).join(', ')).slice(0, 110)}</span>
        </div>
        <span class="bv-total mono">${fmt(v.total)}</span>
        <button class="btn ${completa ? 'btn-ghost' : 'btn-primary'}" ${completa ? 'disabled' : ''}
                onclick="cerrarModal('modal-buscar-venta'); abrirDevolucion('${v.id}')">
          ${icono('regresar', 16)} Devolver
        </button>
      </div>`;
  }).join('');
}

/** Piezas ya devueltas de una venta, por renglón. */
function devueltoDe(ventaId) {
  const porIdx = new Map();
  getVentas().forEach(d => {
    if (d.tipo !== 'devolucion' || d.cancelada || d.ventaOriginal !== ventaId) return;
    (d.items || []).forEach(i => {
      const k = num(i.idxOriginal, -1);
      porIdx.set(k, num(porIdx.get(k)) + num(i.cantidad));
    });
  });
  return porIdx;
}

function abrirDevolucion(ventaId) {
  const v = getVentas().find(x => x.id === ventaId);
  if (!v) { toast('No se encontró ese movimiento.', 'error'); return; }
  if (v.cancelada) { toast('Ese movimiento está cancelado: no hay nada que devolver.', 'warn'); return; }
  if (v.tipo !== 'venta') { toast('Sólo se devuelven ventas de productos.', 'warn'); return; }
  if (!exigirTurnoAbierto()) return;

  const ya = devueltoDe(ventaId);
  const lineas = (v.items || []).map((it, idx) => ({
    idx, nombre: it.nombre, precio: num(it.precio),
    vendidas: num(it.cantidad), yaDevueltas: num(ya.get(idx)), cantidad: 0,
  })).filter(l => l.vendidas - l.yaDevueltas > 0);

  if (!lineas.length) { toast('Esta venta ya se devolvió completa.', 'warn'); return; }

  // Se reembolsa por donde se cobró; si fue mixta, manda el método principal.
  // Si se lo llevó fiado, lo natural es bajárselo de la cuenta, no dar dinero.
  const principal = [...(v.pagos || [])].sort((a, b) => num(b.monto) - num(a.monto))[0];
  const fueFiado  = (v.pagos || []).some(p => p.metodo === 'credito' && num(p.monto) > 0);
  DEVOL = {
    venta: v, lineas, fueFiado,
    metodo: fueFiado ? 'credito'
          : principal && principal.metodo !== 'credito' ? principal.metodo : 'efectivo',
  };
  renderDevolucion();
  abrirModal('modal-devolucion');
}

function totalDevolucion() {
  if (!DEVOL) return 0;
  return redondear(DEVOL.lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
}

function fijarCantidadDevol(idx, valor) {
  const l = DEVOL && DEVOL.lineas.find(x => x.idx === idx);
  if (!l) return;
  l.cantidad = clamp(valor, 0, l.vendidas - l.yaDevueltas);
  renderDevolucion();
}

function todoDevolucion() {
  if (!DEVOL) return;
  DEVOL.lineas.forEach(l => { l.cantidad = l.vendidas - l.yaDevueltas; });
  renderDevolucion();
}

function fijarMetodoDevol(m) { if (DEVOL) { DEVOL.metodo = m; renderDevolucion(); } }

function renderDevolucion() {
  if (!DEVOL) return;
  setText('devol-folio', `Venta #${DEVOL.venta.folio} · ${fmt(DEVOL.venta.total)}`);

  setHTML('devol-lineas', DEVOL.lineas.map(l => {
    const max = l.vendidas - l.yaDevueltas;
    return `
      <div class="devol-linea">
        <div class="devol-info">
          <strong>${esc(l.nombre)}</strong>
          <span class="hint">${fmt(l.precio)} c/u · puede devolver ${fmtNum(max, max % 1 ? 2 : 0)}${
            l.yaDevueltas ? ` · ya devueltas ${fmtNum(l.yaDevueltas, l.yaDevueltas % 1 ? 2 : 0)}` : ''}</span>
        </div>
        <div class="linea-cant">
          <button class="btn-cant" onclick="fijarCantidadDevol(${l.idx}, ${l.cantidad - 1})">−</button>
          <input class="input-cant" inputmode="decimal" value="${l.cantidad}"
                 onchange="fijarCantidadDevol(${l.idx}, this.value)" aria-label="Piezas a devolver"/>
          <button class="btn-cant" onclick="fijarCantidadDevol(${l.idx}, ${l.cantidad + 1})">+</button>
        </div>
        <span class="devol-importe mono">${fmt(l.precio * l.cantidad)}</span>
      </div>`;
  }).join(''));

  // "Fiado" sólo aparece si esa venta salió a crédito: es descontarle la deuda
  const metodos = ['efectivo', 'tarjeta', 'transferencia'].concat(DEVOL.fueFiado ? ['credito'] : []);
  setHTML('devol-metodos', metodos.map(m => `
    <button class="metodo ${DEVOL.metodo === m ? 'activo' : ''}" onclick="fijarMetodoDevol('${m}')">
      <span class="metodo-ico">${icono(METODOS_PAGO[m].icono, 22)}</span>
      <span>${m === 'credito' ? 'Bajar de su cuenta' : METODOS_PAGO[m].label}</span>
    </button>`).join(''));

  const total = totalDevolucion();
  setText('devol-total', fmt(total));
  const btn = document.getElementById('btn-confirmar-devol');
  if (btn) btn.disabled = total <= 0;
}

async function confirmarDevolucion() {
  if (!DEVOL) return;
  const total = totalDevolucion();
  if (total <= 0) { toast('Marca cuántas piezas regresa el cliente.', 'error'); return; }

  const items = DEVOL.lineas.filter(l => l.cantidad > 0).map(l => {
    const orig = DEVOL.venta.items[l.idx] || {};
    return {
      productoId: orig.productoId || null, idxOriginal: l.idx,
      nombre: l.nombre, sku: orig.sku || '',
      precio: l.precio, cantidad: redondear(l.cantidad, 3),
      importe: redondear(l.precio * l.cantidad), tipo: 'devolucion',
      costo: num(orig.costo),          // el mismo con el que se vendió
    };
  });

  const aCuenta = DEVOL.metodo === 'credito';
  const ok = await confirmar({
    titulo: 'Confirmar devolución',
    mensaje: (aCuenta
        ? `Se le descuentan <strong>${fmt(total)}</strong> de lo que debe
           ${DEVOL.venta.cliente ? `<strong>${esc(DEVOL.venta.cliente)}</strong>` : 'el cliente'}
           (no sale dinero de la caja)`
        : `Se regresan <strong>${fmt(total)}</strong> por ${METODOS_PAGO[DEVOL.metodo].label.toLowerCase()}`) +
      ` y ${items.length} renglón(es) vuelven al inventario.<br>
        La venta #${DEVOL.venta.folio} se conserva; queda registrada la devolución.`,
    ok: 'Devolver', peligro: true,
  });
  if (!ok) return;

  const dev = {
    id: nuevoId('dev'), folio: siguienteFolio(), tipo: 'devolucion',
    ventaOriginal: DEVOL.venta.id, folioOriginal: DEVOL.venta.folio,
    turnoId: TURNO.id, cajero: TURNO.cajero,
    fecha: TURNO.fecha || hoyISO(), fechaHora: new Date().toISOString(),
    items, subtotal: total, descuento: 0, total,
    pagos: [{ metodo: DEVOL.metodo, monto: total }],
    recibido: 0, cambio: 0, cliente: DEVOL.venta.cliente || '', cancelada: false,
  };

  aplicarStock(items, +1);                 // la mercancía regresa al anaquel
  const ventas = getVentas();
  ventas.unshift(dev);
  setVentas(ventas);

  DEVOL = null;
  cerrarModal('modal-devolucion');
  renderResumenTurnoPos();
  renderProductos();
  actualizarEstadoGlobal();
  respaldarPronto('devolucion');
  toast(`Devolución de ${fmt(total)} registrada.`, 'success', 5000);
}

/* ================================================ CORREGIR UNA VENTA ===
   No se edita una venta cerrada: se anula y sus renglones vuelven al
   carrito para cobrarla otra vez bien. El folio anulado queda en el
   historial, que es lo que permite auditar el turno. */
async function corregirVenta(ventaId) {
  const ventas = getVentas();
  const v = ventas.find(x => x.id === ventaId);
  if (!v) return;
  if (v.cancelada) { toast('Ese movimiento ya está cancelado.', 'warn'); return; }
  if (v.tipo !== 'venta') { toast('Sólo se corrigen ventas de productos.', 'warn'); return; }
  if (!exigirTurnoAbierto()) return;
  if (v.turnoId !== TURNO.id) {
    toast('Esa venta es de un turno ya cortado: cambiarla movería un corte cerrado. Usa Devolución.', 'warn', 8000);
    return;
  }

  const ok = await confirmar({
    titulo: 'Corregir la venta',
    mensaje: `La venta <strong>#${v.folio}</strong> por ${fmt(v.total)} se anulará y sus productos
              volverán al carrito para que la cobres de nuevo.<br>
              El folio anulado queda en el historial.` +
             (POS.carrito.length ? '<br><br>El ticket que tienes abierto se apartará solo.' : ''),
    ok: 'Corregir', peligro: true,
  });
  if (!ok) return;

  if (POS.carrito.length) nuevoTicket({ silencioso: true });

  v.cancelada = true;
  v.canceladaEn = new Date().toISOString();
  v.motivoCancel = 'corregida';
  aplicarStock(v.items, +1);
  setVentas(ventas);

  POS.carrito = (v.items || []).map(i => ({
    uid: nuevoId('ln'), productoId: i.productoId || null,
    nombre: i.nombre, sku: i.sku || '',
    precio: num(i.precio), cantidad: num(i.cantidad),
    tipo: i.productoId ? 'producto' : 'libre',
  }));
  POS.descuento = num(v.descuento);

  renderCarrito();
  renderProductos();
  renderResumenTurnoPos();
  actualizarEstadoGlobal();
  respaldarPronto('correccion');
  toast(`Venta #${v.folio} anulada. Corrige el ticket y vuelve a cobrar.`, 'info', 6000);
}

/* ------------------------------------------------------------- utilidades */
function exigirTurnoAbierto() {
  if (TURNO.abierto) return true;
  toast('Abre el turno antes de vender: así todo queda en el corte correcto.', 'warn', 5000);
  irA('apertura');
  return false;
}

function abrirVentaLibre() {
  if (!exigirTurnoAbierto()) return;
  setVal('libre-desc', '');
  setVal('libre-precio', '');
  setVal('libre-cantidad', 1);
  abrirModal('modal-libre');
}

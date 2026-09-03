/* ============================================================================
   TANICHI · INVENTARIO
   Catálogo de productos, existencias, entradas de mercancía e importación
   desde archivo CSV. El POS descuenta de aquí en cada venta.
   ========================================================================== */

const INV = { busqueda: '', filtro: 'todos', orden: 'nombre', editandoId: null };

function productoVacio() {
  return {
    id: nuevoId('prd'), sku: '', nombre: '', categoria: 'General',
    precio: 0, costo: 0, stock: 0, stockMin: num(CONFIG.stockMinDefault, 5),
    controlaStock: true, activo: true,
    creado: new Date().toISOString(), actualizado: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- listado */
function renderInventario() {
  const productos = getProductos();
  const cont = document.getElementById('inv-tabla-cuerpo');
  if (!cont) return;

  /* indicadores de arriba */
  const activos   = productos.filter(p => p.activo !== false);
  const conStock  = activos.filter(p => p.controlaStock !== false);
  const bajos     = conStock.filter(p => num(p.stock) > 0 && num(p.stock) <= num(p.stockMin, CONFIG.stockMinDefault));
  const agotados  = conStock.filter(p => num(p.stock) <= 0);
  const valorVenta = redondear(conStock.reduce((s, p) => s + num(p.stock) * num(p.precio), 0));
  const valorCosto = redondear(conStock.reduce((s, p) => s + num(p.stock) * num(p.costo), 0));

  setText('inv-kpi-productos', fmtNum(activos.length));
  setText('inv-kpi-bajos', fmtNum(bajos.length));
  setText('inv-kpi-agotados', fmtNum(agotados.length));
  setText('inv-kpi-valor', fmt(valorVenta));
  setText('inv-kpi-costo', `Costo: ${fmt(valorCosto)}`);
  const alerta = document.getElementById('inv-alerta');
  if (alerta) {
    const n = bajos.length + agotados.length;
    alerta.style.display = n ? 'flex' : 'none';
    alerta.innerHTML = n
      ? `<span>${icono('alerta', 20)}</span><div><strong>${n} producto(s) necesitan resurtido.</strong>
         <button class="link" onclick="filtrarInventario('bajos')">Ver cuáles</button></div>`
      : '';
  }

  /* filtros y orden */
  let lista = productos.filter(p => {
    if (INV.filtro === 'bajos') {
      if (p.controlaStock === false || p.activo === false) return false;
      if (!(num(p.stock) <= num(p.stockMin, CONFIG.stockMinDefault))) return false;
    }
    if (INV.filtro === 'inactivos' && p.activo !== false) return false;
    if (INV.filtro === 'todos' && p.activo === false) return false;
    if (!INV.busqueda) return true;
    return `${p.nombre} ${p.sku || ''} ${p.categoria || ''}`.toLowerCase().includes(INV.busqueda);
  });

  const ordenes = {
    nombre: (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'),
    stock:  (a, b) => num(a.stock) - num(b.stock),
    precio: (a, b) => num(b.precio) - num(a.precio),
    categoria: (a, b) => String(a.categoria || '').localeCompare(String(b.categoria || ''), 'es')
                        || String(a.nombre).localeCompare(String(b.nombre), 'es'),
  };
  lista.sort(ordenes[INV.orden] || ordenes.nombre);

  if (!lista.length) {
    cont.innerHTML = `<tr><td colspan="7">
      <div class="vacio pequeno">
        <div class="vacio-ico">${icono('paquete', 34)}</div>
        <p>${productos.length ? 'Ningún producto coincide con el filtro.' : 'Tu catálogo está vacío. Agrega tu primer producto o importa un CSV.'}</p>
      </div></td></tr>`;
    return;
  }

  cont.innerHTML = lista.map(p => {
    const sc = p.controlaStock === false ? 'libre'
             : num(p.stock) <= 0 ? 'cero'
             : num(p.stock) <= num(p.stockMin, CONFIG.stockMinDefault) ? 'bajo' : 'ok';
    const etiqueta = { libre: 'Sin control', cero: 'Agotado', bajo: 'Bajo', ok: 'Disponible' }[sc];
    return `
      <tr class="${p.activo === false ? 'inactivo' : ''}">
        <td>
          <div class="inv-celda-nom">
            ${fotoDe(p.id)
              ? `<img class="inv-foto" src="${fotoDe(p.id)}" alt=""/>`
              : `<span class="inv-foto vacia">${iconoCategoria(p.categoria)}</span>`}
            <div>
              <div class="inv-nom">${esc(p.nombre)}</div>
              <div class="inv-sub">${p.sku ? esc(p.sku) + ' · ' : ''}${esc(p.categoria || 'General')}${p.activo === false ? ' · inactivo' : ''}</div>
            </div>
          </div>
        </td>
        <td class="mono der">${fmt(p.precio)}</td>
        <td class="mono der oculta-movil">${fmt(p.costo)}</td>
        <td class="mono der oculta-movil">${num(p.precio) > 0 && num(p.costo) > 0 ? fmtNum((1 - num(p.costo) / num(p.precio)) * 100, 0) + '%' : '—'}</td>
        <td class="der"><span class="stock-badge ${sc}">${p.controlaStock === false ? '∞' : fmtNum(p.stock, num(p.stock) % 1 ? 2 : 0)}</span></td>
        <td class="oculta-movil"><span class="stock-txt ${sc}">${etiqueta}</span></td>
        <td class="acciones">
          <button class="btn-icono" title="Entrada de mercancía" onclick="abrirEntrada('${esc(p.id)}')">${icono('mas')}</button>
          <button class="btn-icono" title="Editar" onclick="abrirProducto('${esc(p.id)}')">${icono('lapiz')}</button>
          <button class="btn-icono peligro" title="Eliminar" onclick="eliminarProducto('${esc(p.id)}')">${icono('bote')}</button>
        </td>
      </tr>`;
  }).join('');
}

function buscarInventario(v) { INV.busqueda = String(v || '').toLowerCase().trim(); renderInventario(); }
function filtrarInventario(f) {
  INV.filtro = f;
  $$('#inv-filtros .chip').forEach(b => b.classList.toggle('activo', b.dataset.filtro === f));
  renderInventario();
}
function ordenarInventario(o) { INV.orden = o; renderInventario(); }

/* ------------------------------------------------------------ alta/edición */
function abrirProducto(id = null) {
  const p = id ? buscarProducto(id) : productoVacio();
  if (!p) { toast('Ese producto ya no existe.', 'error'); return; }
  INV.editandoId = id;

  setText('producto-titulo', id ? 'Editar producto' : 'Nuevo producto');
  setVal('pr-nombre', p.nombre);
  setVal('pr-sku', p.sku || '');
  setVal('pr-categoria', p.categoria || 'General');
  setVal('pr-precio', p.precio || '');
  setVal('pr-costo', p.costo || '');
  setVal('pr-stock', p.stock || 0);
  setVal('pr-stockmin', p.stockMin ?? CONFIG.stockMinDefault);
  document.getElementById('pr-controla').checked = p.controlaStock !== false;
  document.getElementById('pr-activo').checked   = p.activo !== false;
  document.getElementById('pr-stock').disabled   = p.controlaStock === false;

  // Sugerencias de categoría a partir de lo ya capturado
  const dl = document.getElementById('dl-categorias');
  if (dl) {
    const cats = [...new Set(getProductos().map(x => x.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    dl.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  }
  prepararFotoProducto(id);
  actualizarMargenProducto();
  abrirModal('modal-producto');
}

function actualizarMargenProducto() {
  const precio = valOf('pr-precio', 0), costo = valOf('pr-costo', 0);
  const el = document.getElementById('pr-margen');
  if (!el) return;
  if (precio > 0 && costo > 0) {
    const gan = redondear(precio - costo);
    const pct = (gan / precio) * 100;
    el.innerHTML = `Ganancia por pieza: <strong>${fmt(gan)}</strong> (${fmtNum(pct, 1)}%)`;
    el.className = 'hint ' + (gan < 0 ? 'malo' : 'bueno');
  } else {
    el.textContent = 'Captura precio y costo para ver tu ganancia por pieza.';
    el.className = 'hint';
  }
}

function guardarProducto() {
  const nombre = (document.getElementById('pr-nombre')?.value || '').trim();
  if (!nombre) { toast('El producto necesita un nombre.', 'error'); return; }
  const precio = valOf('pr-precio', 0);
  if (precio <= 0) { toast('Escribe el precio de venta.', 'error'); return; }

  const sku = (document.getElementById('pr-sku')?.value || '').trim();
  const productos = getProductos();

  // El código/SKU debe ser único: es lo que usa el lector de barras
  if (sku && productos.some(p => p.id !== INV.editandoId && String(p.sku).toLowerCase() === sku.toLowerCase())) {
    toast(`Ya existe otro producto con el código "${sku}".`, 'error');
    return;
  }

  const controla = !!document.getElementById('pr-controla')?.checked;
  const base = INV.editandoId ? productos.find(p => p.id === INV.editandoId) : productoVacio();
  if (!base) { toast('El producto ya no existe.', 'error'); return; }

  Object.assign(base, {
    nombre, sku,
    categoria: (document.getElementById('pr-categoria')?.value || 'General').trim() || 'General',
    precio: redondear(precio),
    costo: redondear(valOf('pr-costo', 0)),
    stock: controla ? redondear(valOf('pr-stock', 0), 3) : 0,
    stockMin: redondear(valOf('pr-stockmin', CONFIG.stockMinDefault), 3),
    controlaStock: controla,
    activo: !!document.getElementById('pr-activo')?.checked,
    actualizado: new Date().toISOString(),
  });

  if (!INV.editandoId) productos.push(base);
  setProductos(productos);
  // La foto va aparte y hasta el final: si no cabe, el producto ya quedó a salvo
  aplicarFotoEditada(base.id);

  cerrarModal('modal-producto');
  renderInventario();
  renderPos();
  respaldarPronto('inventario');
  toast(INV.editandoId ? 'Producto actualizado.' : `"${base.nombre}" agregado al catálogo.`, 'success');
  INV.editandoId = null;
}

async function eliminarProducto(id) {
  const p = buscarProducto(id);
  if (!p) return;
  const vendido = getVentas().some(v => (v.items || []).some(i => i.productoId === id));

  const ok = await confirmar({
    titulo: 'Eliminar producto',
    mensaje: vendido
      ? `<strong>${esc(p.nombre)}</strong> ya tiene ventas registradas.<br>
         Te conviene <strong>desactivarlo</strong> en vez de borrarlo: así desaparece del POS
         pero los tickets y reportes anteriores siguen completos.`
      : `¿Eliminar <strong>${esc(p.nombre)}</strong> del catálogo?`,
    ok: vendido ? 'Eliminar de todos modos' : 'Eliminar',
    peligro: true,
  });
  if (!ok) return;

  setProductos(getProductos().filter(x => x.id !== id));
  borrarFoto(id);                       // que no quede ocupando espacio
  renderInventario();
  renderPos();
  respaldarPronto('inventario');
  toast('Producto eliminado.', 'info');
}

/* --------------------------------------------------- entrada de mercancía */
function abrirEntrada(id) {
  const p = buscarProducto(id);
  if (!p) return;
  if (p.controlaStock === false) { toast('Este producto no lleva control de existencias.', 'warn'); return; }
  INV.editandoId = id;
  setText('entrada-producto', p.nombre);
  setText('entrada-actual', fmtNum(p.stock, num(p.stock) % 1 ? 2 : 0));
  setVal('entrada-cantidad', '');
  setVal('entrada-costo', p.costo || '');
  document.querySelector('input[name="entrada-tipo"][value="entrada"]').checked = true;
  actualizarPreviewEntrada();
  abrirModal('modal-entrada');
}

function actualizarPreviewEntrada() {
  const p = buscarProducto(INV.editandoId);
  if (!p) return;
  const tipo = document.querySelector('input[name="entrada-tipo"]:checked')?.value || 'entrada';
  const cant = valOf('entrada-cantidad', 0);
  const nuevo = tipo === 'ajuste' ? cant
              : tipo === 'salida' ? num(p.stock) - cant
              : num(p.stock) + cant;
  setText('entrada-resultado', fmtNum(redondear(nuevo, 3), redondear(nuevo, 3) % 1 ? 2 : 0));
  const el = document.getElementById('entrada-resultado');
  if (el) el.className = 'entrada-res ' + (nuevo < 0 ? 'malo' : 'bueno');
  show('entrada-costo-wrap', tipo === 'entrada', 'block');
}

function guardarEntrada() {
  const productos = getProductos();
  const p = productos.find(x => x.id === INV.editandoId);
  if (!p) return;

  const tipo = document.querySelector('input[name="entrada-tipo"]:checked')?.value || 'entrada';
  const cant = valOf('entrada-cantidad', 0);
  if (cant <= 0 && tipo !== 'ajuste') { toast('Escribe la cantidad.', 'error'); return; }

  const nuevo = tipo === 'ajuste' ? cant
              : tipo === 'salida' ? num(p.stock) - cant
              : num(p.stock) + cant;
  if (nuevo < 0) { toast('La existencia no puede quedar en negativo.', 'error'); return; }

  p.stock = redondear(nuevo, 3);
  if (tipo === 'entrada') {
    const costo = valOf('entrada-costo', 0);
    if (costo > 0) p.costo = redondear(costo);   // el costo se actualiza al de la última compra
  }
  p.actualizado = new Date().toISOString();
  setProductos(productos);

  cerrarModal('modal-entrada');
  renderInventario();
  renderPos();
  respaldarPronto('inventario');
  toast(`${p.nombre}: existencia actualizada a ${fmtNum(p.stock, p.stock % 1 ? 2 : 0)}.`, 'success');
  INV.editandoId = null;
}

/* ------------------------------------------------------------------- CSV */
async function exportarCatalogoCSV() {
  const productos = getProductos();
  if (!productos.length) { toast('No hay productos que exportar.', 'warn'); return; }
  const cab = ['codigo', 'nombre', 'categoria', 'precio', 'costo', 'existencia', 'minimo', 'controla_stock', 'activo'];
  const filas = productos.map(p => [
    p.sku || '', p.nombre, p.categoria || 'General',
    redondear(p.precio), redondear(p.costo), num(p.stock),
    num(p.stockMin, CONFIG.stockMinDefault),
    p.controlaStock === false ? 'no' : 'si',
    p.activo === false ? 'no' : 'si',
  ]);
  const csv = [cab, ...filas].map(f => f.map(celdaCSV).join(',')).join('\r\n');
  // BOM para que Excel abra los acentos correctamente
  if (await descargarArchivo(`catalogo_tanichi_${hoyISO()}.csv`, '﻿' + csv, 'text/csv')) {
    toast('Catálogo exportado en CSV.', 'success');
  }
}

function celdaCSV(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Lector de CSV que respeta comillas y saltos de línea dentro de una celda. */
function parsearCSV(texto) {
  const t = texto.replace(/^﻿/, '');
  const filas = []; let fila = []; let campo = ''; let enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (enComillas) {
      if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
      else campo += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ',' || ch === ';') { fila.push(campo); campo = ''; }
    else if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(c => String(c).trim() !== ''));
}

async function importarCatalogoCSV(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;

  let filas;
  try { filas = parsearCSV(await file.text()); }
  catch { toast('No se pudo leer el archivo.', 'error'); return; }
  if (filas.length < 2) { toast('El archivo no tiene datos.', 'error'); return; }

  // Los acentos se quitan con escapes \u: un rango escrito con caracteres
  // literales se corrompe si la página no se sirve como UTF-8.
  const cab = filas[0].map(h => h.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const idx = (...nombres) => {
    for (const n of nombres) { const i = cab.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const iNombre = idx('nombre', 'producto', 'descripcion');
  if (iNombre < 0) {
    toast('El CSV debe tener una columna "nombre". Exporta el catálogo para ver el formato.', 'error', 7000);
    return;
  }
  const iSku    = idx('codigo', 'sku', 'clave', 'barras');
  const iCat    = idx('categoria', 'linea', 'grupo');
  const iPrecio = idx('precio', 'precio_venta', 'venta');
  const iCosto  = idx('costo', 'precio_costo', 'compra');
  const iStock  = idx('existencia', 'stock', 'cantidad');
  const iMin    = idx('minimo', 'stock_minimo', 'min');
  const iCtrl   = idx('controla_stock', 'controla');
  const iActivo = idx('activo');

  const productos = getProductos();
  const porSku    = new Map(productos.filter(p => p.sku).map(p => [String(p.sku).toLowerCase(), p]));
  const porNombre = new Map(productos.map(p => [String(p.nombre).toLowerCase(), p]));

  let nuevos = 0, actualizados = 0, omitidos = 0;
  filas.slice(1).forEach(f => {
    const nombre = String(f[iNombre] ?? '').trim();
    if (!nombre) { omitidos++; return; }
    const sku = iSku >= 0 ? String(f[iSku] ?? '').trim() : '';
    // Con código, manda el código. Antes se caía al nombre cuando el código no
    // estaba en el catálogo, y dos productos distintos que se llaman igual
    // (uno de ellos con su propio código) se fundían en uno: se perdía uno.
    // El nombre sólo sirve de respaldo para completar un producto sin código.
    let existente = null;
    if (sku) {
      existente = porSku.get(sku.toLowerCase()) || null;
      if (!existente) {
        const porNom = porNombre.get(nombre.toLowerCase());
        if (porNom && !String(porNom.sku || '').trim()) existente = porNom;
      }
    } else {
      existente = porNombre.get(nombre.toLowerCase()) || null;
    }
    const p = existente || productoVacio();

    p.nombre    = nombre;
    if (sku) p.sku = sku;
    if (iCat    >= 0 && String(f[iCat] ?? '').trim()) p.categoria = String(f[iCat]).trim();
    if (iPrecio >= 0) p.precio   = redondear(num(f[iPrecio]));
    if (iCosto  >= 0) p.costo    = redondear(num(f[iCosto]));
    if (iStock  >= 0) p.stock    = redondear(num(f[iStock]), 3);
    if (iMin    >= 0) p.stockMin = redondear(num(f[iMin]), 3);
    if (iCtrl   >= 0) p.controlaStock = !/^(no|0|false)$/i.test(String(f[iCtrl]).trim());
    if (iActivo >= 0) p.activo        = !/^(no|0|false)$/i.test(String(f[iActivo]).trim());
    p.actualizado = new Date().toISOString();

    if (existente) actualizados++;
    else { productos.push(p); porNombre.set(nombre.toLowerCase(), p); if (p.sku) porSku.set(p.sku.toLowerCase(), p); nuevos++; }
  });

  setProductos(productos);
  renderInventario();
  renderPos();
  respaldarPronto('inventario');
  toast(`Importación lista: ${nuevos} nuevos, ${actualizados} actualizados${omitidos ? `, ${omitidos} omitidos` : ''}.`, 'success', 6000);
}

/** Catálogo de ejemplo para que el POS sea usable desde el primer minuto. */
async function cargarCatalogoEjemplo() {
  if (getProductos().length) {
    const ok = await confirmar({
      titulo: 'Cargar productos de ejemplo',
      mensaje: 'Ya tienes productos en el catálogo. Los de ejemplo se agregarán a los existentes.',
      ok: 'Agregar de todos modos',
    });
    if (!ok) return;
  }
  const ejemplos = [
    ['Coca-Cola 600 ml',   'Bebidas',   20, 14, 24],
    ['Agua 1 L',           'Bebidas',   15, 9,  30],
    ['Sabritas 45 g',      'Botanas',   19, 13, 20],
    ['Galletas Marías',    'Abarrotes', 22, 16, 15],
    ['Leche 1 L',          'Abarrotes', 28, 22, 12],
    ['Pan de caja',        'Abarrotes', 45, 36, 8],
    ['Huevo por kilo',     'Abarrotes', 52, 42, 10],
    ['Café soluble 50 g',  'Abarrotes', 48, 38, 6],
    ['Jabón de tocador',   'Limpieza',  18, 12, 14],
    ['Papel higiénico 4',  'Limpieza',  38, 28, 10],
  ];
  const productos = getProductos();
  ejemplos.forEach(([nombre, categoria, precio, costo, stock]) => {
    productos.push({ ...productoVacio(), nombre, categoria, precio, costo, stock });
  });
  setProductos(productos);
  renderInventario();
  renderPos();
  toast('Catálogo de ejemplo cargado. Edítalo o bórralo cuando quieras.', 'success', 5000);
}

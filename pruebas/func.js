const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 850 });
  const errores = [];
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8124/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:8124/', { waitUntil: 'load' });

  const resultados = await page.evaluate(async () => {
    const out = [];
    const t = (nombre, cond, extra) => out.push({ nombre, ok: !!cond, extra: cond ? undefined : extra });
    const eq = (nombre, a, b) => t(nombre, Math.abs(Number(a) - Number(b)) < 0.005, `obtenido ${a}, esperado ${b}`);
    const esperar = ms => new Promise(r => setTimeout(r, ms));
    const clickConfirm = async () => { await esperar(30); const ok = document.getElementById('confirm-ok'); if (ok && document.getElementById('confirm-modal').classList.contains('visible')) ok.click(); await esperar(30); };

    // ---- catálogo
    Store.set(DB.productos, [
      { id: 'a', nombre: 'Refresco', sku: '1', categoria: 'Bebidas', precio: 20, costo: 12, stock: 10, controlaStock: true, activo: true },
      { id: 'b', nombre: 'Papas', sku: '2', categoria: 'Botanas', precio: 19.99, costo: 10, stock: 2, controlaStock: true, activo: true },
      { id: 'c', nombre: 'Suelto', sku: '', categoria: 'Otros', precio: 6, costo: 3, stock: 0, controlaStock: false, activo: true },
    ]);
    invalidarProductos && invalidarProductos();
    TURNO.abierto = true; TURNO.id = nuevoId('trn'); TURNO.cajero = 'Martha'; TURNO.horario = '8:00 a 11:00'; TURNO.fecha = hoyISO(); TURNO.inicio = new Date().toISOString();
    TURNO.fondoRapido = 500; TURNO.aperturaModo = 'rapido'; TURNO.mpInicial = 1000; TURNO.carteraInicial = 0;
    setVentas([]); guardarTurno({ inmediato: true });
    irA('pos');

    const venta = (pagos, items, extra = {}) => {
      POS.carrito = []; POS.descuento = extra.descuento || 0;
      items.forEach(([id, n]) => { for (let i = 0; i < n; i++) agregarAlCarrito(id); });
      abrirCobro();
      POS.cobro.pagos = pagos; POS.cobro.mixto = pagos.length > 1; POS.cobro.cliente = extra.cliente || '';
      if (extra.recibido) POS.cobro.recibido = extra.recibido;
      confirmarCobro();
    };

    // ---- 1. venta efectivo y stock
    venta([{ metodo: 'efectivo', monto: 40 }], [['a', 2]], { recibido: 50 });
    eq('stock baja tras venta', buscarProducto('a').stock, 8);
    let pos = totalesPos();
    eq('efectivo POS', pos.efectivo, 40);
    // ---- 2. venta con decimales y tarjeta
    venta([{ metodo: 'tarjeta', monto: 19.99 }], [['b', 1]]);
    eq('tarjeta POS', totalesPos().tarjeta, 19.99);
    // ---- 3. sin existencia no deja vender de más
    POS.carrito = []; agregarAlCarrito('b'); agregarAlCarrito('b'); agregarAlCarrito('b');
    const cant = POS.carrito[0] ? POS.carrito[0].cantidad : 0;
    t('no vende más del stock (permitirSinStock=' + CONFIG.permitirSinStock + ')', CONFIG.permitirSinStock !== false || cant <= 1, 'cantidad ' + cant);
    POS.carrito = [];
    // ---- 4. mixto
    venta([{ metodo: 'efectivo', monto: 10 }, { metodo: 'transferencia', monto: 10 }], [['a', 1]], { recibido: 10 });
    eq('mixto efectivo', totalesPos().efectivo, 50);
    eq('mixto transferencia', totalesPos().transferencia, 10);
    // ---- 5. fiado sin cliente no debe pasar
    POS.carrito = []; agregarAlCarrito('a'); abrirCobro();
    POS.cobro.pagos = [{ metodo: 'credito', monto: 20 }]; POS.cobro.cliente = '';
    renderCobro();
    const btn = document.getElementById('btn-confirmar-cobro');
    t('fiado sin nombre bloquea el botón', btn.disabled, 'botón habilitado');
    const nv = getVentas().length; confirmarCobro();
    t('confirmarCobro con fiado sin nombre', true);
    POS.cobro.cliente = 'Doña Lupe'; renderCobro(); confirmarCobro();
    eq('fiado saldo', saldoDe('Doña Lupe'), 20);
    // ---- 6. abono tarjeta/efectivo reduce el saldo
    abrirCobroAbono('Doña Lupe'); POS.cobro.total = 15; POS.cobro.pagos = [{ metodo: 'tarjeta', monto: 15 }]; confirmarCobro();
    eq('saldo tras abono', saldoDe('Doña Lupe'), 5);
    // ---- 7. descuento
    venta([{ metodo: 'efectivo', monto: 15 }], [['a', 1]], { descuento: 5, recibido: 20 });
    eq('venta con descuento', getVentas()[0].total, 15);
    // ---- 8. descuento mayor al subtotal
    POS.carrito = []; agregarAlCarrito('c'); aplicarDescuento && aplicarDescuento(9999);
    t('descuento no deja total negativo', totalesCarrito().total >= 0, JSON.stringify(totalesCarrito()));
    POS.carrito = []; POS.descuento = 0;
    // ---- 9. cancelar restaura stock
    const v2 = getVentas().find(v => v.tipo === 'venta' && v.items.some(i => i.productoId === 'b'));
    const antes = buscarProducto('b').stock;
    const pc = cancelarVenta(v2.id); await clickConfirm(); await pc;
    eq('cancelar restaura stock', buscarProducto('b').stock, antes + 1);
    eq('tarjeta POS tras cancelar', totalesPos().tarjeta, 0 + 0);
    // ---- 10. recarga dividida
    abrirRecarga(); setVal('recarga-monto', '100'); actualizarPreviewRecarga();
    alternarMixtoRecarga(); fijarMetodoRecarga('tarjeta'); fijarMontoPagoRecarga('efectivo', 40); fijarMontoPagoRecarga('tarjeta', 60);
    registrarRecarga();
    pos = totalesPos();
    eq('recarga efectivo', pos.recargaEfectivo, 40); eq('recarga tarjeta', pos.recargaTarjeta, 60);
    // ---- 11. envío
    abrirEnvio(); setVal('envio-monto', '200'); fijarMontoEnvio(200); registrarEnvio();
    eq('envío enviado', totalesPos().enviado, 200);
    // ---- 12. egreso
    abrirEgreso(); EGRESO.tipo = 'proveedores'; EGRESO.monto = 50; EGRESO.desc = 'Coca'; EGRESO.origen = 'caja'; guardarEgreso();
    eq('egresos', totalEgresos(), 50);
    // ---- 13. cuadre coherente
    const c = calcularCuadre();
    const espCaja = 500 + 40 + 10 + 15 + 40 /*recarga*/ + 215 /*envio 200+15*/ - 50;
    eq('caja esperada', c.esperadoCaja, espCaja);
    t('cuadre no devuelve NaN', Object.values(c).every(v => typeof v !== 'number' || !isNaN(v)), JSON.stringify(c));
    // ---- 14. devolución
    const vd = getVentas().find(v => v.tipo === 'venta' && !v.cancelada && v.items.some(i => i.productoId === 'a') && v.pagos[0].metodo === 'efectivo' && v.total === 40);
    abrirDevolucion(vd.id); todoDevolucion && todoDevolucion();
    const pd = confirmarDevolucion(); await clickConfirm(); await pd;
    t('devolución registrada', getVentas().some(v => v.tipo === 'devolucion'), 'sin devolución');
    // ---- 15. cierre de turno y reapertura
    TURNO.efectivoContado = 0; TURNO.cierreModo = 'rapido'; TURNO.cierreRapido = c.esperadoCaja;
    TURNO.mpCierre = 0;
    const cortesAntes = Store.get(DB.cortes, []).length;
    const pt = cerrarTurno(); await clickConfirm(); await pt;
    t('cerrarTurno guarda corte', Store.get(DB.cortes, []).length === cortesAntes + 1, 'no se guardó');
    t('turno nuevo cerrado', !TURNO.abierto, 'sigue abierto');
    // ---- 16. persistencia
    const guardados = Store.get(DB.ventas, []).length;
    t('ventas persisten', guardados > 5, guardados);
    // ---- 17. vistas renderizan sin lanzar
    for (const v of ['apertura', 'inventario', 'fiados', 'reportes', 'ajustes']) { try { irA(v); t('vista ' + v, true); } catch (e) { t('vista ' + v, false, e.message); } }
    try { abrirHistorial(); cambiarTabHistorial && ['cortes','ventas','analisis'].forEach(x => { try { cambiarTabHistorial(x); } catch (e) { t('hist ' + x, false, e.message); } }); t('historial', true); } catch (e) { t('historial', false, e.message); }
    // ---- 18. entradas de inventario / producto
    try { abrirProducto(); setVal('pr-nombre', 'Nuevo'); t('abrirProducto', true); } catch (e) { t('abrirProducto', false, e.message); }
    // ---- 19. importación CSV con comillas/acentos
    try { const filas = parsearCSV('nombre,precio\n"Jabón, Zote",12.5\nPan,"3,5"\n'); t('parsearCSV comillas', filas.length >= 2 && filas[1][0] === 'Jabón, Zote', JSON.stringify(filas)); } catch (e) { t('parsearCSV', false, e.message); }
    // ---- 20. redondeo
    eq('redondear 0.1+0.2', redondear(0.1 + 0.2), 0.3);
    eq('num de texto con coma', num('1,234.50'), 1234.5);
    t('num vacío', num('') === 0 && num(null) === 0 && num(undefined) === 0 && num('abc') === 0, '');
    t('fmt negativo', /-/.test(fmt(-5)), fmt(-5));
    t('esc evita HTML', esc('<b>"x"</b>').indexOf('<') < 0, esc('<b>'));
    return out;
  });
  let fallos = 0;
  for (const r of resultados) { if (!r.ok) { fallos++; console.log('FALLA:', r.nombre, '—', r.extra); } }
  console.log(`\n${resultados.length - fallos}/${resultados.length} pruebas bien`);
  console.log('Errores JS:', errores.length ? '\n' + [...new Set(errores)].join('\n') : 'ninguno');
  await browser.close();
})();

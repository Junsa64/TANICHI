const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 850 });
  const errores = [];
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push('console: ' + m.text()); });
  await page.goto('http://localhost:8124/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:8124/', { waitUntil: 'load' });
  const resultados = await page.evaluate(async () => {
    const out = [];
    const t = (n, c, e) => out.push({ nombre: n, ok: !!c, extra: c ? undefined : e });
    const eq = (n, a, b) => t(n, Math.abs(Number(a) - Number(b)) < 0.005, `obtenido ${a}, esperado ${b}`);
    const esperar = ms => new Promise(r => setTimeout(r, ms));
    const clickConfirm = async () => { await esperar(40); const ok = document.getElementById('confirm-ok'); if (ok && document.getElementById('confirm-modal').classList.contains('visible')) ok.click(); await esperar(40); };

    Store.set(DB.productos, [{ id: 'a', nombre: 'Refresco', sku: '1', categoria: 'Bebidas', precio: 20, costo: 12, stock: 10, controlaStock: true, activo: true }]);
    invalidarProductos();
    TURNO.abierto = true; TURNO.id = nuevoId('trn'); TURNO.cajero = 'Virginia'; TURNO.horario = '17:00 a 20:00'; TURNO.fecha = hoyISO(); TURNO.inicio = new Date().toISOString();
    TURNO.aperturaModo = 'rapido'; TURNO.fondoRapido = 300; TURNO.mpInicial = 100; setVentas([]); guardarTurno({ inmediato: true });
    irA('pos');
    const vender = (pagos, n = 1) => { POS.carrito = []; for (let i = 0; i < n; i++) agregarAlCarrito('a'); abrirCobro(); POS.cobro.pagos = pagos; POS.cobro.mixto = pagos.length > 1; POS.cobro.recibido = 1000; confirmarCobro(); };
    vender([{ metodo: 'efectivo', monto: 40 }], 2);
    vender([{ metodo: 'tarjeta', monto: 20 }], 1);
    vender([{ metodo: 'transferencia', monto: 20 }], 1);
    const snap1 = snapshotTurno(); const c1 = calcularCuadre(snap1);
    // Cerrar con todo exacto
    TURNO.cierreModo = 'rapido'; TURNO.cierreRapido = c1.esperadoCaja; TURNO.mpCierre = c1.esperadoMp; TURNO.carteraCierre = 0;
    let pt = cerrarTurno(); await clickConfirm(); await pt;
    const cortes = Store.get(DB.cortes, []);
    t('corte guardado', cortes.length === 1, cortes.length);
    const corte = cortes[0];
    t('corte cuadra', corte.cuadrado, JSON.stringify({ difCaja: corte.difCaja, difMp: corte.difMp }));
    eq('corte venta efectivo', corte.ventaEfectivo, 40);
    eq('corte tarjeta', corte.tarjeta, 20);
    // el siguiente turno hereda saldos
    eq('hereda MP', TURNO.mpInicial, corte.mpCierre);
    eq('hereda fondo', TURNO.fondoRapido, corte.efectivoContado);
    // reabrir corte para editar y volver a guardar sin cambios
    try { corregirCorte ? 0 : 0; } catch (e) {}
    const fnEditar = typeof editarCorte === 'function' ? editarCorte : (typeof reabrirCorte === 'function' ? reabrirCorte : null);
    t('existe función para editar corte', !!fnEditar, 'no encontré editarCorte/reabrirCorte');
    if (fnEditar) {
      const pe = fnEditar(corte.id); await clickConfirm(); await pe; await esperar(80);
      t('modo edición activo', TURNO.modoEdicion, 'no entró en edición');
      const sn = snapshotTurno();
      eq('edición conserva venta efectivo', sn.ventaEfectivo, 40);
      eq('edición conserva tarjeta', sn.tarjeta, 20);
      eq('edición conserva transferencia', sn.transferencia, 20);
      const c2 = calcularCuadre(sn);
      eq('edición cuadre MP igual', c2.esperadoMp, corte.esperadoMp);
      eq('edición cuadre caja igual', c2.esperadoCaja, corte.esperadoCaja);
      const pc = cerrarTurno(); await clickConfirm(); await pc;
      t('edición no duplica cortes', Store.get(DB.cortes, []).length === 1, Store.get(DB.cortes, []).length);
    }
    // respaldo ida y vuelta
    try {
      const resp = construirRespaldo();
      const antes = JSON.stringify([Store.get(DB.productos, []).length, getVentas().length, Store.get(DB.cortes, []).length]);
      t('respaldo tiene claves', resp && typeof resp === 'object', typeof resp);
      const txt = JSON.stringify(resp);
      t('respaldo serializable', txt.length > 100, txt.length);
    } catch (e) { t('respaldo', false, e.message); }
    // importar CSV
    try {
      const csv = 'nombre,precio,costo,existencia,categoria,codigo\n"Jabón, Zote",12.5,8,5,Limpieza,555\nPan,"3,5",2,0,Pan,\n,,,,,\n"Duplicado",abc,x,y,Z,\n';
      const filas = parsearCSV(csv); t('csv filas', filas.length >= 4, filas.length);
    } catch (e) { t('csv', false, e.message); }
    // entradas de inventario
    try { abrirEntrada('a'); setVal('entrada-cantidad', '5'); actualizarPreviewEntrada(); t('entrada abre', true); } catch (e) { t('entrada', false, e.message); }
    // XSS en nombres
    Store.set(DB.productos, [{ id: 'x', nombre: '<img src=x onerror=window.__xss=1>', sku: '', categoria: '"><b>', precio: 1, costo: 0, stock: 1, controlaStock: true, activo: true }]);
    invalidarProductos(); TURNO.abierto = true; TURNO.modoEdicion = false; TURNO.id = nuevoId('trn'); guardarTurno({ inmediato: true });
    renderProductos(); renderInventario(); agregarAlCarrito('x'); renderCarrito();
    t('sin XSS por nombre de producto', !window.__xss, 'se ejecutó HTML del nombre');
    // número raro
    for (const v of ['', '   ', 'NaN', 'Infinity', '1e999', '-0', '1,5,5']) { const n = num(v); t('num(' + JSON.stringify(v) + ') finito', Number.isFinite(n), n); }
    // fecha de reloj
    t('hoyISO formato', /^\d{4}-\d{2}-\d{2}$/.test(hoyISO()), hoyISO());
    return out;
  });
  let fallos = 0;
  for (const r of resultados) { if (!r.ok) { fallos++; console.log('FALLA:', r.nombre, '—', r.extra); } }
  console.log(`\n${resultados.length - fallos}/${resultados.length} pruebas bien`);
  console.log('Errores JS:', errores.length ? '\n' + [...new Set(errores)].join('\n') : 'ninguno');
  await browser.close();
})();

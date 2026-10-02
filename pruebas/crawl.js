const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'a';
const SIZES = [[1440, 850], [1100, 800], [820, 900]];
const VISTAS = ['apertura', 'pos', 'inventario', 'corte', 'fiados', 'reportes', 'ajustes'];
const MODALES = ['modal-cobro','modal-envio','modal-egreso','modal-nuevo-fiado','modal-libre','modal-recarga','modal-producto','modal-entrada','modal-novedades','modal-historial','modal-consulta','modal-buscar-venta','modal-movimientos'];

// Detecta texto que se sale de su caja o elementos de texto que se encima
const DETECT = () => {
  const res = [];
  const clipped = el => { const r = el.getBoundingClientRect(); for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const q = p.getBoundingClientRect(); if (r.right <= q.left + 1 || r.left >= q.right - 1 || r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return true; } } return false; };
  const vis = el => { if (clipped(el)) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const sel = (el) => (el.id ? '#' + el.id : '') + '.' + [...el.classList].join('.') + ' <' + el.tagName.toLowerCase() + '> "' + (el.textContent || '').trim().slice(0, 40) + '"';
  const root = document.querySelector('.vista.activa') || document.body;
  const open = document.querySelector('.modal-overlay.visible');
  const scope = open || root;
  // 1) desborde horizontal de elementos con texto
  scope.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && el.children.length === 0 && el.clientWidth > 0 && (el.textContent || '').trim()) {
      res.push('DESBORDE ' + sel(el) + ` (${el.scrollWidth}>${el.clientWidth})`);
    }
    // texto cortado por overflow hidden sin ellipsis
    if (el.scrollWidth > el.clientWidth + 2 && (s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && el.children.length === 0 && (el.textContent || '').trim()) {
      res.push('CORTADO ' + sel(el) + ` (${el.scrollWidth}>${el.clientWidth})`);
    }
  });
  // 2) encimado entre hojas de texto hermanas
  const leaves = [...scope.querySelectorAll('*')].filter(e => vis(e) && e.children.length === 0 && (e.textContent || '').trim());
  const rects = leaves.map(e => ({ e, r: e.getBoundingClientRect() }));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ox > 3 && oy > 3) {
      // ignorar si alguno está recortado por un ancestro con overflow
      res.push('ENCIMADO ' + sel(a.e) + '  <>  ' + sel(b.e));
    }
  }
  // 3) la página entera se desborda de lado
  if (document.documentElement.scrollWidth > innerWidth + 2) res.push('PAGINA-SCROLL-X ' + document.documentElement.scrollWidth + '>' + innerWidth);
  return res.slice(0, 40);
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const report = [];
  const errores = [];
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    page.on('pageerror', e => errores.push(`[${w}] pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(`[${w}] console: ${m.text()}`); });
    await page.goto('http://localhost:8124/', { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto('http://localhost:8124/', { waitUntil: 'load' });
    // datos de prueba realistas
    await page.evaluate(() => {
      const nombres = ['Coca-Cola 600 ml', 'Sabritas Original 45 g', 'Pan Bimbo Blanco Grande', 'Agua Ciel 1 L', 'Galletas Marías Gamesa 170 g paquete familiar', 'Cigarros (suelto)', 'Leche Lala Entera 1 L', 'Huevo San Juan 12 pzas', 'Frijoles La Sierra Refritos 430 g', 'Jabón Zote 400 g'];
      const cats = ['Bebidas', 'Botanas', 'Pan', 'Bebidas', 'Botanas', 'Cigarros', 'Lácteos', 'Abarrotes', 'Abarrotes', 'Limpieza'];
      setProductosSeed = nombres.map((n, i) => ({ id: 'p' + i, nombre: n, sku: '7501' + i, categoria: cats[i], precio: 12 + i * 7.5, costo: 8 + i * 5, stock: i === 2 ? 0 : 3 + i * 4, controlaStock: i !== 5, activo: true }));
      Store.set(DB.productos, setProductosSeed);
      TURNO.abierto = true; TURNO.id = nuevoId('trn'); TURNO.cajero = 'Martha'; TURNO.horario = '8:00 a 11:00'; TURNO.fecha = hoyISO(); TURNO.inicio = new Date().toISOString();
      guardarTurno({ inmediato: true });
    });
    if (process.argv[3] === 'dark') await page.evaluate(() => saveConfig({ tema: 'oscuro' }));
    await page.reload({ waitUntil: 'load' });
    for (const v of VISTAS) {
      await page.evaluate((v) => { irA(v); }, v);
      await new Promise(r => setTimeout(r, 250));
      const probs = await page.evaluate(DETECT);
      await page.screenshot({ path: path.join(OUT, `${TAG}_${w}_${v}.png`) });
      if (probs.length) report.push({ w, vista: v, probs });
      if (v === 'corte') {
        for (const tab of ['efectivo', 'ingresos', 'egresos', 'saldos', 'cuadre', 'reporte']) {
          await page.evaluate((t) => { if (typeof irAPanelCorte === 'function') irAPanelCorte(t); else document.querySelector(`[onclick*="'${t}'"]`)?.click(); }, tab);
          await new Promise(r => setTimeout(r, 200));
          const pr = await page.evaluate(DETECT);
          await page.screenshot({ path: path.join(OUT, `${TAG}_${w}_corte-${tab}.png`) });
          if (pr.length) report.push({ w, vista: 'corte/' + tab, probs: pr });
        }
      }
    }
    await page.evaluate(() => irA('pos'));
    for (const m of MODALES) {
      const ok = await page.evaluate((m) => {
        try {
          const fn = { 'modal-cobro': () => { agregarAlCarrito('p0'); agregarAlCarrito('p4'); abrirCobro(); }, 'modal-envio': abrirEnvio, 'modal-egreso': () => abrirEgreso(), 'modal-nuevo-fiado': () => abrirModal('modal-nuevo-fiado'), 'modal-libre': abrirVentaLibre, 'modal-recarga': abrirRecarga, 'modal-producto': () => { irA('inventario'); (typeof abrirProducto==='function'?abrirProducto():abrirModal('modal-producto')); }, 'modal-entrada': () => abrirModal('modal-entrada'), 'modal-novedades': () => abrirModal('modal-novedades'), 'modal-historial': () => abrirModal('modal-historial'), 'modal-consulta': abrirConsulta, 'modal-buscar-venta': abrirBuscarVenta, 'modal-movimientos': abrirMovimientos }[m];
          fn(); return true;
        } catch (e) { return 'ERR ' + e.message; }
      }, m);
      await new Promise(r => setTimeout(r, 250));
      if (ok !== true) { report.push({ w, vista: m, probs: [String(ok)] }); }
      const pr = await page.evaluate(DETECT);
      await page.screenshot({ path: path.join(OUT, `${TAG}_${w}_${m}.png`) });
      if (pr.length) report.push({ w, vista: m, probs: pr });
      await page.evaluate((m) => { try { cerrarModal(m); } catch (e) {} document.querySelectorAll('.modal-overlay').forEach(o => o.classList.remove('visible')); document.body.classList.remove('modal-open'); }, m);
      await page.evaluate(() => irA('pos'));
    }
    await page.close();
  }
  await browser.close();
  console.log('ERRORES JS:', errores.length ? '\n' + [...new Set(errores)].join('\n') : 'ninguno');
  for (const r of report) { console.log(`\n== ${r.w}px · ${r.vista} (${r.probs.length})`); r.probs.slice(0, 12).forEach(p => console.log('  ' + p)); }
  fs.writeFileSync(path.join(__dirname, `report_${TAG}.json`), JSON.stringify({ errores, report }, null, 1));
})();

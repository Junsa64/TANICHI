const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const casos = {
    'turno JSON roto': { 'tanichi.turno': '{bad' },
    'ventas con basura': { 'tanichi.ventas': '[null, 5, {"tipo":"venta"}, {"tipo":"abono","pagos":null,"total":"x"}]' },
    'productos incompletos': { 'tanichi.productos': '[{"id":"z"},{"nombre":"Sin id"},null,{"id":"q","nombre":"N","precio":"abc","stock":null}]' },
    'cortes con basura': { 'tanichi.cortes': '[{},{"id":1},null]' },
    'config rota': { 'tanichi.config': '{"comisionTerminalPct":"mucho","cajeros":"x","turnos":null}' },
  };
  for (const [nombre, datos] of Object.entries(casos)) {
    const page = await b.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load/.test(m.text())) errs.push(m.text()); });
    await page.goto('http://localhost:8124/', { waitUntil: 'load' });
    await page.evaluate((d) => { localStorage.clear(); for (const k in d) localStorage.setItem(k, d[k]); }, datos);
    await page.goto('http://localhost:8124/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 500));
    const r = await page.evaluate(() => { const o = []; for (const v of ['apertura','inventario','fiados','reportes','ajustes']) { try { irA(v); } catch (e) { o.push(v + ': ' + e.message); } }
      try { TURNO.abierto = true; TURNO.id = TURNO.id || 'x'; TURNO.fecha = hoyISO(); guardarTurno({inmediato:true}); irA('pos'); renderPos(); } catch (e) { o.push('pos: ' + e.message); }
      try { irA('corte'); renderCorte(); calcularCuadre(); } catch (e) { o.push('corte: ' + e.message); }
      try { abrirHistorial(); } catch (e) { o.push('historial: ' + e.message); }
      return o; });
    console.log(nombre.padEnd(24), r.length || errs.length ? '\n   ' + [...r, ...errs].join('\n   ') : 'ok');
    await page.close();
  }
  await b.close();
})();

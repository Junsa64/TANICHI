const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p.startsWith('/__mp')) { r.writeHead(400, { 'Content-Type': 'application/json' }); return r.end('{"error":"sin servidor mp en pruebas"}'); }
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
}).listen(8124, () => console.log('listo'));

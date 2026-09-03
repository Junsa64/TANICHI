/* ============================================================================
   Empaqueta TANICHI en un solo archivo HTML, listo para publicar como Artifact.
   Los Artifacts no admiten archivos externos: aquí se incrustan CSS, JS y logo.

   Uso:  node construir-artifact.js
   Sale: dist/tanichi.html
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* Logo reducido a 128 px WebP (4.7 KB en vez de los 520 KB del original):
   un Artifact viaja por red y el icono original pesaba más que toda la app. */
const LOGO = 'data:image/webp;base64,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';

let html = leer('index.html');

/* La lista de módulos se lee del propio index.html, en su orden real. Antes
   estaba escrita a mano aquí y al agregar iconos.js quedó fuera del paquete:
   el artifact salió sin iconos y reventaba. Derivarla evita que vuelva a
   desfasarse. */
const MODULOS = [...html.matchAll(/<script src="js\/([a-z]+)\.js(?:\?[^"]*)?"><\/script>/g)]
  .map(m => m[1]);
if (!MODULOS.length) {
  console.error('NO se generó el archivo: no se encontró ningún <script src="js/…"> en index.html');
  process.exit(1);
}

/* Un Artifact ya viene envuelto en doctype/html/head/body: aquí sólo va el
   contenido. El <title> es el nombre en la galería: un nombre, no una
   descripción (la explicación va aparte, al publicar). */
const titulo = 'Punto de Venta TANICHI';
html = html
  .replace(/^[\s\S]*?<body>/i, '')
  .replace(/<\/body>[\s\S]*$/i, '')
  .trim();

/* Hojas y scripts externos, dentro del archivo */
const css = leer('style.css');
const js  = MODULOS.map(m => `/* ===== js/${m}.js ===== */\n` + leer(`js/${m}.js`)).join('\n\n');

/* El logo deja de ser un archivo suelto */
html = html.replace(/src="icon\.png"/g, `src="${LOGO}"`);

/* Los <script src="js/..."> se sustituyen por un único bloque al final */
html = html.replace(/\n?\s*<script src="js\/[^"]+"><\/script>/g, '');

const salida = `<title>${titulo}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
${css}
</style>

${html}

<script>
${js}
</script>
`;

/* Comprobaciones antes de escribir: un fallo aquí publica una página rota */
const problemas = [];
if (/<script src=/.test(salida))            problemas.push('quedó un <script src> sin incrustar');
if (/href="style\.css"/.test(salida))       problemas.push('quedó el enlace a style.css');
if (/"icon\.png"/.test(salida))             problemas.push('quedó una referencia a icon.png');
// En un archivo suelto no existen. Se buscan etiquetas de verdad: el texto
// suelto aparece dentro del propio JavaScript y no es un problema.
if (/<link[^>]+rel=["']manifest["']/i.test(salida)) problemas.push('quedó el enlace al manifiesto');

/* Los dos números de versión tienen que coincidir. Si no, la app se creería
   vieja para siempre y se recargaría en círculo. */
const vMeta = (leer('index.html').match(/name="tanichi-version"\s+content="(\d+)"/) || [])[1];
const vJs   = (leer('js/app.js').match(/const VERSION_APP = '(\d+)'/) || [])[1];
if (!vMeta || !vJs) problemas.push('no se encontró alguno de los dos números de versión');
else if (vMeta !== vJs) problemas.push(`versiones descuadradas: index.html dice ${vMeta} y app.js dice ${vJs}`);
if (/<link[^>]+icono-(192|512|mask)\.jpg/i.test(salida)) problemas.push('quedó un enlace a un icono suelto');
if (/<\/script>/.test(js))                  problemas.push('un módulo contiene </script> y rompería el bloque');
if (!/<!DOCTYPE/i.test(salida) === false)   problemas.push('quedó el doctype');
MODULOS.forEach(m => { if (!salida.includes(`js/${m}.js =====`)) problemas.push(`falta el módulo ${m}`); });

if (problemas.length) {
  console.error('NO se generó el archivo:\n - ' + problemas.join('\n - '));
  process.exit(1);
}

fs.mkdirSync(path.join(RAIZ, 'dist'), { recursive: true });
const destino = path.join(RAIZ, 'dist', 'tanichi.html');
fs.writeFileSync(destino, salida, 'utf8');

console.log('Generado:', destino);
console.log('Tamaño  :', (Buffer.byteLength(salida) / 1024).toFixed(0), 'KB');
console.log('Título  :', titulo);

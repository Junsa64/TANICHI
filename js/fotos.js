/* ============================================================================
   TANICHI · FOTOS DE PRODUCTO
   ---------------------------------------------------------------------------
   Las fotos NO viven dentro de cada producto: van en su propia clave, un mapa
   { idProducto: dataURL }. Dos razones, las dos importantes en una tienda:

     1. Guardar el catálogo (precios, existencias) no vuelve a arrastrar
        megabytes de imagen en cada venta.
     2. Si un día no cabe una foto, el producto se guarda igual. El cobro
        nunca se cae por una imagen.

   Cada foto se recorta a cuadro y se reduce a 160 px antes de guardarse:
   entra en unos 8 KB en vez de los 3 MB que pesa la del celular.
   ========================================================================== */

DB.imagenes = 'tanichi.imagenes';

const FOTO_LADO    = 160;          // px del lado del cuadro final
const FOTO_CALIDAD = 0.72;         // JPEG: por debajo de esto ya se nota fea
const FOTO_AVISO   = 3 * 1024 * 1024;   // a partir de aquí avisamos
const FOTO_TOPE    = 4.5 * 1024 * 1024; // aquí ya no aceptamos más

let _fotos = null;   // caché en memoria: se lee mucho al pintar el POS

function getFotos() {
  if (_fotos === null) _fotos = Store.get(DB.imagenes, {});
  return _fotos;
}

function setFotos(mapa) {
  _fotos = mapa;
  return Store.set(DB.imagenes, mapa);
}

/** La foto de un producto, o cadena vacía si no tiene. */
function fotoDe(productoId) {
  return (productoId && getFotos()[productoId]) || '';
}

function tieneFoto(productoId) { return !!fotoDe(productoId); }

/** Bytes aproximados que ocupan todas las fotos juntas. */
function pesoFotos() {
  const m = getFotos();
  let bytes = 0;
  for (const k in m) bytes += m[k].length;
  return bytes;
}

function cuantasFotos() { return Object.keys(getFotos()).length; }

function pesoLegible(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, 0)} KB`;
  return `${fmtNum(bytes / (1024 * 1024), 1)} MB`;
}

/* --------------------------------------------------------------- procesado */

/**
 * Convierte el archivo que eligió el usuario en un cuadro pequeño.
 * Recorta al centro para que todas las fotos se vean parejas en la rejilla.
 */
function procesarFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('sin archivo')); return; }
    if (!/^image\//.test(file.type)) { reject(new Error('no es una imagen')); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const lienzo = document.createElement('canvas');
        lienzo.width = lienzo.height = FOTO_LADO;
        const ctx = lienzo.getContext('2d');

        // Fondo blanco: si la imagen trae transparencia, el JPEG no la respeta
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, FOTO_LADO, FOTO_LADO);

        // Recorte centrado al cuadrado más grande que quepa
        const lado = Math.min(img.width, img.height);
        const sx = (img.width - lado) / 2;
        const sy = (img.height - lado) / 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);

        resolve(lienzo.toDataURL('image/jpeg', FOTO_CALIDAD));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no se pudo leer la imagen')); };
    img.src = url;
  });
}

/** Guarda la foto de un producto. Devuelve true si se pudo. */
function guardarFoto(productoId, dataURL) {
  const mapa = { ...getFotos() };
  const anterior = mapa[productoId];
  mapa[productoId] = dataURL;

  const peso = Object.values(mapa).reduce((s, v) => s + v.length, 0);
  if (peso > FOTO_TOPE) {
    toast(`Las fotos ya ocupan ${pesoLegible(peso)}. Quita algunas antes de agregar más.`, 'error', 8000);
    return false;
  }

  if (!setFotos(mapa)) {
    // No cupo: dejamos el mapa como estaba para no perder las que sí había
    if (anterior) mapa[productoId] = anterior; else delete mapa[productoId];
    setFotos(mapa);
    toast('No hubo espacio para la foto. El producto sí se guardó.', 'warn', 7000);
    return false;
  }

  if (peso > FOTO_AVISO) {
    toast(`Ojo: las fotos van en ${pesoLegible(peso)}. Conviene ponerlas sólo donde ayuden.`, 'warn', 7000);
  }
  return true;
}

function borrarFoto(productoId) {
  const mapa = { ...getFotos() };
  if (!mapa[productoId]) return;
  delete mapa[productoId];
  setFotos(mapa);
}

/* --------------------------------------------- control dentro del formulario */

let FOTO_EDIT = null;   // dataURL en edición; null = no se tocó

/** Prepara el recuadro de foto al abrir el formulario de un producto. */
function prepararFotoProducto(productoId) {
  FOTO_EDIT = productoId ? (fotoDe(productoId) || '') : '';
  renderFotoProducto();
}

function renderFotoProducto() {
  const caja = document.getElementById('pr-foto-caja');
  if (!caja) return;
  const hay = !!FOTO_EDIT;

  caja.innerHTML = hay
    ? `<img src="${FOTO_EDIT}" alt="Foto del producto" class="pr-foto-img"/>`
    : `<span class="pr-foto-vacia">${icono('paquete', 26)}<span>Sin foto</span></span>`;

  show('pr-foto-quitar', hay, 'inline-flex');
  setText('pr-foto-btn-txt', hay ? 'Cambiar foto' : 'Agregar foto');
}

/** Llega desde <input type="file">: el celular ofrece cámara o galería. */
async function elegirFotoProducto(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;

  try {
    FOTO_EDIT = await procesarFoto(file);
    renderFotoProducto();
    toast(`Foto lista (${pesoLegible(FOTO_EDIT.length)}). Guarda el producto para conservarla.`, 'info', 5000);
  } catch (e) {
    toast('No se pudo leer esa imagen. Prueba con otra.', 'error');
  }
}

function quitarFotoProducto() {
  FOTO_EDIT = '';
  renderFotoProducto();
}

/** La llama guardarProducto() una vez que el producto ya tiene id. */
function aplicarFotoEditada(productoId) {
  if (FOTO_EDIT === null) return;          // no se abrió el control
  if (FOTO_EDIT) guardarFoto(productoId, FOTO_EDIT);
  else borrarFoto(productoId);
  FOTO_EDIT = null;
}

/* ------------------------------------------------------------------ ajustes */

function renderAjustesFotos() {
  const n = cuantasFotos();
  setText('aj-fotos-conteo', n ? `${fmtNum(n)} producto(s) con foto` : 'Ningún producto tiene foto todavía');
  setText('aj-fotos-peso', pesoLegible(pesoFotos()));
  const btn = document.getElementById('aj-fotos-borrar');
  if (btn) btn.disabled = !n;
}

async function borrarTodasLasFotos() {
  const n = cuantasFotos();
  if (!n) return;
  const ok = await confirmar({
    titulo: 'Quitar todas las fotos',
    mensaje: `Se borrarán las <strong>${fmtNum(n)}</strong> fotos del catálogo y se liberarán
              ${pesoLegible(pesoFotos())}.<br>Los productos, precios y existencias no se tocan.`,
    ok: 'Quitar las fotos', peligro: true,
  });
  if (!ok) return;
  setFotos({});
  renderAjustesFotos();
  renderInventario();
  renderPos();
  toast('Fotos eliminadas.', 'success');
}

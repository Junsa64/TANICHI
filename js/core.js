/* ============================================================================
   TANICHI · CORE
   Almacenamiento, utilidades, temas, modales, toasts y respaldos.
   Este archivo lo usan TODOS los módulos (POS, Inventario, Corte, Historial).
   ========================================================================== */

/* ---------------------------------------------------------------- claves */
const DB = {
  config:      'tanichi.config',
  productos:   'tanichi.productos',
  turno:       'tanichi.turno',
  cortes:      'tanichi.cortes',
  ventas:      'tanichi.ventas',
  sugerencias: 'tanichi.sugerencias',
  ui:          'tanichi.ui',
};

/* Claves de la versión anterior, para migrar sin perder datos */
const DB_LEGACY = {
  estado:       'corteCajaDenomState',
  historial:    'corteCajaHistorial',
  autocomplete: 'corteCajaAutocomplete',
};

/* ------------------------------------------------------------ almacén JSON */
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return structuredClone(fallback);
      const val = JSON.parse(raw);
      return val === null || val === undefined ? structuredClone(fallback) : val;
    } catch (e) {
      console.warn(`[Store] "${key}" corrupto, se usa el valor por defecto.`, e);
      return structuredClone(fallback);
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`[Store] no se pudo guardar "${key}"`, e);
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        toast('Espacio de almacenamiento lleno. Exporta un respaldo y limpia historial antiguo.', 'error', 8000);
      }
      return false;
    }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* noop */ } },
};

/* --------------------------------------------------------------- config */
const CONFIG_DEFAULT = {
  negocio: 'EL TANICHI',
  lema: 'Punto de Venta y Corte de Caja',
  cajeros: ['Martha', 'Virginia'],
  turnos: [
    { horario: '8:00 a 11:00',  cajero: 'Martha'   },
    { horario: '11:00 a 14:00', cajero: 'Virginia' },
    { horario: '14:00 a 17:00', cajero: 'Martha'   },
    { horario: '17:00 a 20:00', cajero: 'Virginia' },
  ],
  comisionTerminalPct: 4.06,   // % que cobra la terminal por venta con tarjeta
  recargaCada: 50,             // por cada $50 de recarga…
  recargaMonto: 2,             // …Mercado Pago regresa $2
  stockMinDefault: 5,
  compacta: false,                     // barra de arriba achicada
  comisionEnvio: 15,           // lo que cobras por transferir dinero a un cliente
  tarjetaCreditoAlias: '',     // ej. "Tarjeta BBVA": si se deja vacío usa "Tarjeta de crédito"
  tarjetaCreditoDiaCorte: null, // día del mes (1-31) en que el banco cierra el periodo
  tarjetaCreditoDiaPago: null,  // día del mes (1-31) en que vence el pago
  tarjetaCreditoMonitoreo: true, // llevar el control de cuánto debes; si se apaga,
                                 // se puede seguir comprando con ella pero sin pedir
                                 // saldos ni compararlos en el corte
  permitirSinStock: true,      // vender aunque el sistema marque 0 (sólo avisa)
  ticketPie: '¡Gracias por su compra!',
  tema: 'claro',
  acento: 'tanichi',
  respaldoAuto: true,
};

let CONFIG = CONFIG_DEFAULT;

function loadConfig() {
  CONFIG = { ...CONFIG_DEFAULT, ...Store.get(DB.config, {}) };
  // Saneamiento: valores fuera de rango rompen todos los cálculos
  CONFIG.comisionTerminalPct = clamp(num(CONFIG.comisionTerminalPct, 4.06), 0, 100);
  CONFIG.recargaCada  = Math.max(1, num(CONFIG.recargaCada, 50));
  CONFIG.recargaMonto = Math.max(0, num(CONFIG.recargaMonto, 2));
  if (!Array.isArray(CONFIG.cajeros) || !CONFIG.cajeros.length) CONFIG.cajeros = [...CONFIG_DEFAULT.cajeros];
  if (!Array.isArray(CONFIG.turnos)  || !CONFIG.turnos.length)  CONFIG.turnos  = structuredClone(CONFIG_DEFAULT.turnos);
  if (typeof aplicarAliasTarjetaCredito === 'function') aplicarAliasTarjetaCredito();
  return CONFIG;
}

function saveConfig(patch) {
  CONFIG = { ...CONFIG, ...(patch || {}) };
  Store.set(DB.config, CONFIG);
  aplicarTema();
  if (typeof aplicarAliasTarjetaCredito === 'function') aplicarAliasTarjetaCredito();
  return CONFIG;
}

/* ------------------------------------------------------------- numéricos */

/** Convierte cualquier cosa a número finito; si no puede, devuelve `def`. */
function num(v, def = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-+]/g, ''));
  return Number.isFinite(n) ? n : def;
}

/** Redondeo a centavos, sin los errores de coma flotante de JS. */
function redondear(n, decimales = 2) {
  const f = Math.pow(10, decimales);
  return Math.round((num(n) + Number.EPSILON) * f) / f;
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, num(n))); }

/** Dos cantidades de dinero son iguales si difieren menos de medio centavo. */
function igualDinero(a, b) { return Math.abs(num(a) - num(b)) < 0.005; }

/** Formato de moneda mexicana. */
function fmt(n) {
  const v = redondear(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-MX', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** Igual que fmt() pero con signo explícito (+/-), para diferencias. */
function fmtDiff(n) {
  const v = redondear(n);
  return (v > 0 ? '+' : '') + fmt(v);
}

function fmtNum(n, dec = 0) {
  return num(n).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* --------------------------------------------------------------- fechas */

/** Fecha local en formato YYYY-MM-DD.
 *  (toISOString() usa UTC y en México adelanta el día a partir de las 18:00). */
function hoyISO(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** "Viernes, 28 de agosto de 2026" — sólo la inicial en mayúscula.
 *  (CSS `capitalize` produciría "28 De Agosto De 2026"). */
function capitalizar(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function fechaLarga(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return capitalizar(d.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
}

function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function horaDe(isoDateTime) {
  const d = new Date(isoDateTime);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function fechaHoraCorta(isoDateTime) {
  const d = new Date(isoDateTime);
  if (isNaN(d)) return '';
  return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ ids */
let _idSeq = 0;
function nuevoId(prefijo = 'id') {
  _idSeq = (_idSeq + 1) % 100000;
  return `${prefijo}_${Date.now().toString(36)}_${_idSeq.toString(36)}`;
}

/* ------------------------------------------------------------ seguridad */

/** Escapa texto que se va a interpolar dentro de HTML.
 *  Sin esto, un producto llamado  Coca 600 " x2  rompe el markup. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Evalúa expresiones aritméticas simples tecleadas en un campo ("70+23*2").
 *  Analizador propio: no usa eval() ni new Function(). */
function evaluarExpresion(txt) {
  const s = String(txt ?? '').replace(/\s+/g, '');
  if (!s || !/^[0-9+\-*/().]+$/.test(s)) return null;
  if (!/[+\-*/]/.test(s.slice(1))) return null; // sin operadores: no es expresión

  let i = 0;
  const peek = () => s[i];
  const eat  = (c) => { if (s[i] === c) { i++; return true; } return false; };

  function expr() {                       // suma y resta
    let v = term();
    if (v === null) return null;
    for (;;) {
      if (eat('+'))      { const r = term(); if (r === null) return null; v += r; }
      else if (eat('-')) { const r = term(); if (r === null) return null; v -= r; }
      else return v;
    }
  }
  function term() {                       // multiplicación y división
    let v = unario();
    if (v === null) return null;
    for (;;) {
      if (eat('*'))      { const r = unario(); if (r === null) return null; v *= r; }
      else if (eat('/')) { const r = unario(); if (r === null || r === 0) return null; v /= r; }
      else return v;
    }
  }
  function unario() {
    if (eat('-')) { const v = unario(); return v === null ? null : -v; }
    if (eat('+')) return unario();
    return primario();
  }
  function primario() {
    if (eat('(')) { const v = expr(); if (v === null || !eat(')')) return null; return v; }
    const inicio = i;
    while (i < s.length && /[0-9.]/.test(peek())) i++;
    if (i === inicio) return null;
    const v = parseFloat(s.slice(inicio, i));
    return Number.isFinite(v) ? v : null;
  }

  const r = expr();
  if (r === null || i !== s.length || !Number.isFinite(r)) return null;
  return redondear(r);
}

/* ------------------------------------------------------------------ DOM */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function valOf(id, def = 0) { const el = document.getElementById(id); return el ? num(el.value, def) : def; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function show(id, visible, display = 'block') {
  const el = document.getElementById(id); if (el) el.style.display = visible ? display : 'none';
}

/* --------------------------------------------------------------- toasts */
function toast(msg, tipo = 'info', ms = 3600) {
  const cont = document.getElementById('toast-container');
  if (!cont) { console.log(`[${tipo}] ${msg}`); return; }
  const iconos = { info: 'alerta', success: 'palomita', error: 'cerrar', warn: 'alerta' };
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `<span class="toast-ico">${icono(iconos[tipo] || iconos.info, 18)}</span><span>${esc(msg)}</span>`;
  cont.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
}

/* --------------------------------------------------------------- modales */
/** Lo que se puede enfocar dentro de un modal, en orden. */
function enfocablesDe(modal) {
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modal)
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Mantiene el tabulador DENTRO del modal.
 * Sin esto, tabulando se salía a los botones de atrás y el cajero acababa
 * escribiendo en la pantalla equivocada sin darse cuenta.
 */
function atraparTab(ev) {
  if (ev.key !== 'Tab') return;
  const modal = $$('.modal-overlay.visible').pop();
  if (!modal) return;
  const campos = enfocablesDe(modal);
  if (!campos.length) return;
  const primero = campos[0], ultimo = campos[campos.length - 1];

  if (!modal.contains(document.activeElement)) {
    ev.preventDefault(); primero.focus(); return;
  }
  if (ev.shiftKey && document.activeElement === primero) { ev.preventDefault(); ultimo.focus(); }
  else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
}
document.addEventListener('keydown', atraparTab, true);

/**
 * Lo que el modal viene a hacer: su botón principal.
 * El ticket es la excepción — ahí lo natural al dar Enter es cerrarlo y
 * seguir vendiendo, no mandarlo a la impresora.
 */
function accionPrincipalModal(modal) {
  if (!modal) return false;
  if (modal.id === 'modal-ticket') { cerrarModal('modal-ticket'); return true; }
  const btn = modal.querySelector('.modal-pie .btn-primary:not([disabled])');
  if (btn) { btn.click(); return true; }
  return false;
}

/**
 * Enter dentro de un modal lo lleva al siguiente paso.
 * Se queda fuera lo que necesita Enter para otra cosa: los textos largos,
 * los buscadores (que filtran mientras escribes) y los campos de cálculo,
 * que ya avanzan de campo en campo por su cuenta.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const modal = $$('.modal-overlay.visible').pop();
  if (!modal) return;

  const el = document.activeElement;
  if (el) {
    if (el.tagName === 'TEXTAREA') return;
    if (el.hasAttribute('data-sin-enter')) return;
    if (el.classList && el.classList.contains('js-calc')) return;   // lo lleva el otro
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return;       // Enter ya lo activa
  }
  if (accionPrincipalModal(modal)) e.preventDefault();
});

function abrirModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  document.body.classList.add('modal-open');
  const foco = el.querySelector('[data-autofocus]') || enfocablesDe(el)[0];
  // preventScroll: enfocar un campo que no es el primero arrastraba el modal
  // hacia abajo y escondía lo que va arriba (la foto del producto, por ejemplo).
  if (foco) setTimeout(() => {
    try { foco.focus({ preventScroll: true }); } catch { foco.focus(); }
    if (foco.select) foco.select();
  }, 60);
}

function cerrarModal(id, ev) {
  // Un clic fuera NO cierra: cerrar a media captura por rozar el fondo hacía
  // perder lo escrito. Se sale con la ✕, con Cancelar o con Escape.
  if (ev) return;
  const el = document.getElementById(id);
  if (el) el.classList.remove('visible');
  if (!$$('.modal-overlay.visible').length) document.body.classList.remove('modal-open');
}

function cerrarModalesAbiertos() {
  $$('.modal-overlay.visible').forEach(el => el.classList.remove('visible'));
  document.body.classList.remove('modal-open');
}

/** Confirmación con diseño propio (reemplaza a confirm(), que bloquea el hilo
 *  y se ve distinto en cada navegador). Devuelve una promesa booleana. */
function confirmar({ titulo, mensaje, ok = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal');
    setText('confirm-titulo', titulo);
    setHTML('confirm-mensaje', mensaje);
    const btnOk = document.getElementById('confirm-ok');
    const btnNo = document.getElementById('confirm-cancelar');
    btnOk.textContent = ok;
    btnNo.textContent = cancelar;
    btnOk.className = 'btn ' + (peligro ? 'btn-danger' : 'btn-primary');
    document.getElementById('confirm-modal-box').classList.toggle('danger', !!peligro);

    const cerrar = (val) => {
      overlay.classList.remove('visible');
      if (!$$('.modal-overlay.visible').length) document.body.classList.remove('modal-open');
      btnOk.onclick = null; btnNo.onclick = null; overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(false); };

    btnOk.onclick = () => cerrar(true);
    btnNo.onclick = () => cerrar(false);
    overlay.onclick = (e) => { if (e.target === overlay) cerrar(false); };
    document.addEventListener('keydown', onKey);

    overlay.classList.add('visible');
    document.body.classList.add('modal-open');
    setTimeout(() => btnOk.focus(), 60);
  });
}

/* ----------------------------------------------------------------- temas */
/* El tono tiñe toda la interfaz: cabecera, pestañas, botones y estados.
   184° reproduce el turquesa del rótulo de la tienda. */
const ACENTOS = {
  tanichi:   { hue: 184, nombre: 'Tanichi'   },
  azul:      { hue: 214, nombre: 'Azul'      },
  verde:     { hue: 158, nombre: 'Verde'     },
  violeta:   { hue: 268, nombre: 'Violeta'   },
  ambar:     { hue: 32,  nombre: 'Ámbar'     },
  rosa:      { hue: 340, nombre: 'Rosa'      },
};

function aplicarTema() {
  const root = document.documentElement;
  root.setAttribute('data-tema', CONFIG.tema === 'oscuro' ? 'oscuro' : 'claro');
  const acento = ACENTOS[CONFIG.acento] ? CONFIG.acento : 'tanichi';
  root.style.setProperty('--acento-h', ACENTOS[acento].hue);
  root.setAttribute('data-acento', acento);
}

function alternarTema() {
  saveConfig({ tema: CONFIG.tema === 'claro' ? 'oscuro' : 'claro' });
  const btn = document.getElementById('btn-tema');
  if (btn) btn.innerHTML = icono(CONFIG.tema === 'claro' ? 'luna' : 'sol', 20);
}

/* ------------------------------------------------------------ sugerencias
   Autocompletado aprendido de lo que el usuario escribe (proveedores,
   servicios, conceptos de egreso/ingreso).                                */
function getSugerencias(clave) {
  const all = Store.get(DB.sugerencias, {});
  return Array.isArray(all[clave]) ? all[clave] : [];
}

function addSugerencia(clave, valor) {
  const v = String(valor || '').trim();
  if (!v) return;
  const all = Store.get(DB.sugerencias, {});
  if (!Array.isArray(all[clave])) all[clave] = [];
  if (!all[clave].some(x => x.toLowerCase() === v.toLowerCase())) {
    all[clave].push(v);
    all[clave].sort((a, b) => a.localeCompare(b, 'es'));
    Store.set(DB.sugerencias, all);
    refrescarDatalists();
  }
}

function borrarSugerencia(clave, valor) {
  const all = Store.get(DB.sugerencias, {});
  if (!Array.isArray(all[clave])) return;
  all[clave] = all[clave].filter(x => x !== valor);
  Store.set(DB.sugerencias, all);
  refrescarDatalists();
}

/** Rellena los <datalist> del documento con las sugerencias guardadas. */
function refrescarDatalists() {
  $$('datalist[data-sugerencias]').forEach(dl => {
    const clave = dl.getAttribute('data-sugerencias');
    dl.innerHTML = getSugerencias(clave).map(v => `<option value="${esc(v)}"></option>`).join('');
  });
}

/* ------------------------------------------------------------- respaldos */

/** Arma el objeto de respaldo completo del sistema. */
function construirRespaldo() {
  return {
    formato: 'tanichi-backup',
    version: 2,
    generado: new Date().toISOString(),
    config:      Store.get(DB.config, {}),
    productos:   Store.get(DB.productos, []),
    cortes:      Store.get(DB.cortes, []),
    ventas:      Store.get(DB.ventas, []),
    sugerencias: Store.get(DB.sugerencias, {}),
    turno:       Store.get(DB.turno, null),
    imagenes:    Store.get(DB.imagenes, {}),
  };
}

/* Publicado como página en claude.ai, el navegador no deja que la página
   descargue por su cuenta: hay que pedírselo al visor. Abriendo el archivo
   en local esa vía no existe y se usa el enlace de siempre. */
let _capDescargas;
function capacidadDescargas() {
  if (_capDescargas === undefined) {
    _capDescargas = (window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('downloads').catch(() => null)
      : Promise.resolve(null);
  }
  return _capDescargas;
}

/** Entrega un archivo al usuario. Devuelve true si se guardó. */
async function descargarArchivo(nombre, contenido, tipo = 'application/json') {
  const visor = await capacidadDescargas();
  if (visor) {
    try {
      await visor.save({ filename: nombre, data: contenido });
      return true;
    } catch (e) {
      const codigo = e && e.code;
      if (codigo === 'declined')     { toast('Descarga cancelada.', 'info'); return false; }
      if (codigo === 'rate_limited') { toast('Ya hay una descarga en curso. Espera un momento.', 'warn'); return false; }
      if (codigo === 'too_large')    { toast('El archivo pesa demasiado. Borra historial antiguo y vuelve a intentarlo.', 'error', 8000); return false; }
      if (codigo === 'bad_request')  { toast('No se pudo preparar el archivo.', 'error'); return false; }
      // Cualquier otro caso: se intenta la vía clásica
    }
  }

  const blob = new Blob([contenido], { type: tipo + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

async function exportarRespaldo() {
  const data = construirRespaldo();
  if (await descargarArchivo(`respaldo_tanichi_${hoyISO()}.json`, JSON.stringify(data, null, 2))) {
    toast('Respaldo guardado.', 'success');
  }
}

/* --- respaldo automático en una carpeta elegida por el usuario ----------
   Usa la File System Access API (Chrome/Edge). El permiso se pide una vez;
   el "handle" se guarda en IndexedDB porque no es serializable a JSON.     */

const IDB_NOMBRE = 'tanichi-fs';
const IDB_STORE  = 'handles';

function idbAbrir() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('sin indexedDB'));
    const req = indexedDB.open(IDB_NOMBRE, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSet(clave, valor) {
  const db = await idbAbrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(valor, clave);
    tx.oncomplete = () => resolve(true);
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbGet(clave) {
  const db = await idbAbrir();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(clave);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

const Respaldo = {
  soportado() { return typeof window.showDirectoryPicker === 'function'; },
  _dir: null,

  /** Pide al usuario una carpeta donde escribir los respaldos. */
  async elegirCarpeta() {
    if (!this.soportado()) {
      toast('Tu navegador no permite elegir carpeta. Usa Chrome o Edge, o exporta el respaldo manualmente.', 'warn', 7000);
      return false;
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'tanichi-respaldos', mode: 'readwrite' });
      await idbSet('respaldoDir', dir);
      this._dir = dir;
      toast(`Carpeta de respaldo configurada: ${dir.name}`, 'success');
      renderEstadoRespaldo();
      await this.escribir('inicial');
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;   // el usuario canceló
      console.warn('[Respaldo] no se pudo elegir carpeta', e);
      // Abriendo el HTML directamente (file://) el navegador no permite elegir
      // carpeta: hay que servirlo por http o exportar el respaldo a mano.
      const porFile = location.protocol === 'file:' || (e && e.name === 'SecurityError');
      toast(porFile
        ? 'Al abrir el archivo directamente, el navegador no permite elegir carpeta. Usa “Exportar respaldo ahora”; el sistema también descarga una copia en cada corte.'
        : 'No se pudo configurar la carpeta de respaldo.', porFile ? 'warn' : 'error', 9000);
      return false;
    }
  },

  async quitarCarpeta() {
    await idbSet('respaldoDir', null).catch(() => {});
    this._dir = null;
    renderEstadoRespaldo();
    toast('Respaldo automático en carpeta desactivado.', 'info');
  },

  /** Recupera el handle guardado y verifica que el permiso siga vigente. */
  async carpeta({ pedirPermiso = false } = {}) {
    if (!this.soportado()) return null;
    if (!this._dir) {
      try { this._dir = await idbGet('respaldoDir'); } catch { this._dir = null; }
    }
    if (!this._dir) return null;
    try {
      let permiso = await this._dir.queryPermission({ mode: 'readwrite' });
      if (permiso === 'prompt' && pedirPermiso) {
        permiso = await this._dir.requestPermission({ mode: 'readwrite' });
      }
      return permiso === 'granted' ? this._dir : null;
    } catch {
      return null;
    }
  },

  /** Escribe el respaldo completo en la carpeta. Silencioso si no hay carpeta. */
  async escribir(motivo = 'auto') {
    if (!CONFIG.respaldoAuto) return false;
    const dir = await this.carpeta();
    if (!dir) return false;
    try {
      const data = JSON.stringify(construirRespaldo(), null, 2);
      // Un archivo por día (se sobreescribe) + uno "ultimo" siempre al día
      for (const nombre of [`respaldo_tanichi_${hoyISO()}.json`, 'respaldo_tanichi_ultimo.json']) {
        const fh = await dir.getFileHandle(nombre, { create: true });
        const ws = await fh.createWritable();
        await ws.write(data);
        await ws.close();
      }
      const est = document.getElementById('respaldo-ultimo');
      if (est) est.textContent = `Último respaldo: ${fechaHoraCorta(new Date().toISOString())} (${motivo})`;
      return true;
    } catch (e) {
      console.warn('[Respaldo] fallo al escribir', e);
      return false;
    }
  },
};

/** Respaldo tras un evento importante (venta, corte). Se agrupa para no
 *  escribir en disco en cada tecla. */
let _respaldoTimer = null;
function respaldarPronto(motivo = 'auto', ms = 4000) {
  clearTimeout(_respaldoTimer);
  _respaldoTimer = setTimeout(() => Respaldo.escribir(motivo), ms);
}

async function renderEstadoRespaldo() {
  const el = document.getElementById('respaldo-estado');
  if (!el) return;
  if (!Respaldo.soportado() || location.protocol === 'file:') {
    el.innerHTML = `<span class="pill pill-warn">Respaldo en carpeta no disponible</span>
      <p class="hint">${location.protocol === 'file:'
        ? 'Al abrir el archivo directamente, el navegador no deja escribir en una carpeta. No pasa nada: en cada corte se descarga una copia de seguridad automáticamente en tu carpeta de Descargas.'
        : 'Este navegador no permite escribir en una carpeta. Usa Chrome o Edge, o exporta el respaldo a mano.'}
      </p>`;
    return;
  }
  const dir = await Respaldo.carpeta();
  el.innerHTML = dir
    ? `<span class="pill pill-ok">Activo · carpeta “${esc(dir.name)}”</span>
       <p class="hint" id="respaldo-ultimo">Se guarda solo después de cada venta y cada corte.</p>`
    : `<span class="pill pill-off">Sin carpeta configurada</span>
       <p class="hint">Elige una carpeta para que el sistema guarde una copia de seguridad automáticamente.</p>`;
}

/* --------------------------------------------------------- importar datos */
async function importarRespaldo(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('El archivo no es un respaldo válido (JSON dañado).', 'error');
    return;
  }

  // Acepta el formato nuevo y el de la versión anterior (solo historial)
  const cortesNuevos = Array.isArray(data.cortes) ? data.cortes
                     : Array.isArray(data.historial) ? data.historial : null;
  if (!cortesNuevos) {
    toast('El archivo no contiene cortes de caja.', 'error');
    return;
  }

  const ok = await confirmar({
    titulo: 'Importar respaldo',
    mensaje: `Se combinarán <strong>${cortesNuevos.length} cortes</strong>` +
             (Array.isArray(data.ventas) ? ` y <strong>${data.ventas.length} ventas</strong>` : '') +
             (Array.isArray(data.productos) ? ` y <strong>${data.productos.length} productos</strong>` : '') +
             ` con tus datos actuales.<br>Los registros repetidos no se duplican.`,
    ok: 'Importar',
  });
  if (!ok) return;

  const fusionar = (actual, entrante, clave = 'id') => {
    const mapa = new Map();
    [...actual, ...entrante].forEach(x => { if (x && x[clave] !== undefined) mapa.set(String(x[clave]), x); });
    return [...mapa.values()];
  };

  // Un respaldo de la versión anterior trae los campos con otros nombres
  const cortes = fusionar(Store.get(DB.cortes, []), cortesNuevos.map(normalizarCorteLegacy))
    .sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')));
  Store.set(DB.cortes, cortes);

  if (Array.isArray(data.ventas)) {
    const ventas = fusionar(Store.get(DB.ventas, []), data.ventas)
      .sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')));
    Store.set(DB.ventas, ventas);
    invalidarVentas();          // lo guardado en memoria quedó viejo
  }
  if (Array.isArray(data.productos)) {
    Store.set(DB.productos, fusionar(Store.get(DB.productos, []), data.productos));
    invalidarProductos();
  }
  if (data.sugerencias && typeof data.sugerencias === 'object') {
    const act = Store.get(DB.sugerencias, {});
    Object.entries(data.sugerencias).forEach(([k, arr]) => {
      if (!Array.isArray(arr)) return;
      const set = new Set([...(act[k] || []), ...arr]);
      act[k] = [...set].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    });
    Store.set(DB.sugerencias, act);
  }
  // Las fotos se suman a las que ya hay; si no caben, el resto del respaldo
  // ya quedó guardado y no se pierde nada importante.
  if (data.imagenes && typeof data.imagenes === 'object') {
    Store.set(DB.imagenes, { ...Store.get(DB.imagenes, {}), ...data.imagenes });
  }

  toast('Respaldo importado correctamente.', 'success');
  setTimeout(() => location.reload(), 900);
}

/* ------------------------------------------------------------- migración
   Convierte los datos de la versión anterior (corteCaja*) al formato nuevo,
   una sola vez, sin borrar los originales.                                */
function migrarDatosAnteriores() {
  const yaMigrado = Store.get(DB.ui, {}).migradoV2;
  if (yaMigrado) return;

  const ui = Store.get(DB.ui, {});
  let migrados = 0;

  try {
    const histViejo = JSON.parse(localStorage.getItem(DB_LEGACY.historial) || '[]');
    if (Array.isArray(histViejo) && histViejo.length) {
      const actuales = Store.get(DB.cortes, []);
      const mapa = new Map(actuales.map(c => [String(c.id), c]));
      histViejo.forEach(c => {
        if (!c || c.id === undefined) return;
        if (mapa.has(String(c.id))) return;
        mapa.set(String(c.id), normalizarCorteLegacy(c));
        migrados++;
      });
      Store.set(DB.cortes, [...mapa.values()]
        .sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || ''))));
    }
  } catch (e) { console.warn('[Migración] historial anterior ilegible', e); }

  try {
    const acViejo = JSON.parse(localStorage.getItem(DB_LEGACY.autocomplete) || '{}');
    if (acViejo && typeof acViejo === 'object') {
      const sug = Store.get(DB.sugerencias, {});
      const mapaClaves = {
        proveedores: 'proveedores', servicios: 'servicios', honorarios: 'honorarios',
        'otros-ingresos': 'otros-ingresos', 'otros-retiros': 'otros-retiros',
      };
      Object.entries(acViejo).forEach(([k, arr]) => {
        const destino = mapaClaves[k] || k;
        if (!Array.isArray(arr)) return;
        sug[destino] = [...new Set([...(sug[destino] || []), ...arr])].filter(Boolean);
      });
      Store.set(DB.sugerencias, sug);
    }
  } catch (e) { console.warn('[Migración] autocompletado anterior ilegible', e); }

  ui.migradoV2 = true;
  Store.set(DB.ui, ui);
  if (migrados) toast(`Se importaron ${migrados} cortes de la versión anterior.`, 'success', 6000);
}

/** Traduce un corte de la versión anterior al vocabulario nuevo.
 *  Los nombres cambiaron (ventaDia → ventaEfectivo, retiros → egresos,
 *  bancoInicial → carteraInicial…) y las piezas se guardaban como "100_caja".
 *  Sin esta traducción el cuadre de los cortes viejos saldría en ceros. */
function normalizarCorteLegacy(c) {
  if (c.esperadoCaja !== undefined && c.ventaEfectivo !== undefined) return c;  // ya es del formato nuevo

  const piezas = (obj) => {
    const salida = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      const valor = parseFloat(String(k).split('_')[0]);
      if (Number.isFinite(valor) && num(v) > 0) salida[valor] = num(salida[valor]) + num(v);
    });
    return salida;
  };

  const recargas      = Array.isArray(c.recargasList) ? c.recargasList : [];
  const totalRecargas = num(c.totalRecargas, recargas.reduce((s, r) => s + num(r.monto), 0));

  const norm = {
    ...c,
    origen: c.origen || 'legacy',

    horario: c.horario || c.turno || '',
    aperturaModo: c.aperturaModo || (c.aperturaManualToggle ? 'rapido' : 'conteo'),
    cierreModo:   c.cierreModo   || (c.cierreManualToggle   ? 'rapido' : 'conteo'),
    piezasApertura: c.piezasApertura && !('undefined' in c.piezasApertura) ? piezas(c.piezasApertura) : {},
    piezasCierre:   piezas(c.piezasCierre),

    fondoApertura:   num(c.fondoApertura),
    efectivoContado: num(c.efectivoContado !== undefined ? c.efectivoContado : c.totalCaja),

    ventaEfectivo:   num(c.ventaEfectivo   !== undefined ? c.ventaEfectivo   : c.ventaDia),
    tarjeta:         num(c.tarjeta),
    transferencia:   num(c.transferencia),
    pagoCreditos:    num(c.pagoCreditos),
    creditoClientes: num(c.creditoClientes !== undefined ? c.creditoClientes : c.creditos),
    otrosIngresos:   num(c.otrosIngresos   !== undefined ? c.otrosIngresos   : c.otros),
    otrosIngresosList: c.otrosIngresosList || c.otrosList || [],

    proveedores:  c.proveedores  || c.proveedoresList  || [],
    servicios:    c.servicios    || c.serviciosList    || [],
    honorarios:   c.honorarios   || c.honorariosList   || [],
    otrosEgresos: c.otrosEgresos || c.otrosRetirosList || [],
    egresos:      num(c.egresos !== undefined ? c.egresos : c.retiros),

    dotacion:       num(c.dotacion),
    carteraInicial: num(c.carteraInicial !== undefined ? c.carteraInicial : c.bancoInicial),
    carteraCierre:  num(c.carteraCierre  !== undefined ? c.carteraCierre
                        : (c.bancoCorte !== undefined ? c.bancoCorte : c.totalCartera)),
    mpInicial: num(c.mpInicial), mpRetiros: num(c.mpRetiros), mpCierre: num(c.mpCierre),

    recargas, totalRecargas,
    comisionRecargas: num(c.comisionRecargas, comisionPorRecargas(totalRecargas)),
    obs: c.obs || '',
  };

  // Se recalcula el cuadre con las cifras ya traducidas
  const cu = calcularCuadre(norm);
  return {
    ...norm,
    esperadoCaja: cu.esperadoCaja, difCaja: cu.difCaja,
    esperadoMp: cu.esperadoMp, difMp: cu.difMp,
    esperadoCartera: cu.esperadoCart, difCartera: cu.difCart,
    comisionTerminalMonto: cu.comisionTerminal, tarjetaNeto: cu.tarjetaNeto,
    totalFisico: cu.totalFisico, totalDigital: cu.totalDigital,
    totalValorizado: cu.totalValorizado, ventaTotal: cu.ventaTotal,
    cuadrado: cu.todoOk,
  };
}

/** Comisión que Mercado Pago regresa por las recargas hechas en la terminal. */
function comisionPorRecargas(total) {
  const cada  = Math.max(1, num(CONFIG.recargaCada, 50));
  const monto = Math.max(0, num(CONFIG.recargaMonto, 2));
  return Math.floor(num(total) / cada) * monto;
}

/** Comisión que cobra la terminal bancaria por cobros con tarjeta. */
function comisionTerminal(bruto) {
  return redondear(num(bruto) * (num(CONFIG.comisionTerminalPct, 4.06) / 100));
}

/* ------------------------------------------- campos numéricos con fórmula
   Permite escribir "120+45*2" en cualquier campo de dinero. Se evalúa al
   salir del campo o al presionar Enter.                                    */
function activarCamposCalculadora(raiz = document) {
  raiz.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!el.classList.contains('js-calc')) return;
    if (e.key === 'Enter') {
      aplicarFormula(el);
      e.preventDefault();

      /* Enter avanza al siguiente campo, como en una hoja de cálculo. Dentro
         de un modal la búsqueda se limita a ese modal: antes saltaba a campos
         de la pantalla de atrás. Y al llegar al último, hace lo que el modal
         viene a hacer —cobrar, guardar— en vez de quedarse parado. */
      const modal = el.closest('.modal-overlay.visible');
      const campos = $$('input.js-calc, input.js-next, select.js-next', modal || document)
        .filter(x => x.offsetParent !== null && !x.disabled && !x.readOnly);
      const i = campos.indexOf(el);

      if (i >= 0 && i < campos.length - 1) {
        campos[i + 1].focus();
        campos[i + 1].select?.();
      } else if (modal) {
        accionPrincipalModal(modal);
      }
    }
  });
  raiz.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.classList.contains('js-calc')) aplicarFormula(el);
  });
  // La rueda del ratón sobre un campo numérico cambia su valor sin querer
  raiz.addEventListener('wheel', (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) el.blur();
  }, { passive: true });
}

function aplicarFormula(el) {
  const raw = el.value;
  if (!raw || !/[+\-*/]/.test(String(raw).slice(1))) return;
  const r = evaluarExpresion(raw);
  if (r === null) return;
  el.value = r;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/* Los campos de dinero son type="text" con inputmode numérico para poder
   aceptar fórmulas; esta función normaliza lo que el usuario deja escrito. */
function normalizarCampoDinero(el) {
  const v = evaluarExpresion(el.value);
  if (v !== null) el.value = v;
}

/* ============================================================================
   TANICHI · ARRANQUE Y NAVEGACIÓN
   Une los módulos: apertura de turno, punto de venta, inventario, corte de
   caja, historial y ajustes.
   ========================================================================== */

let VISTA = 'apertura';

/* ------------------------------------------------------------ navegación */
function irA(vista) {
  // El POS necesita un turno abierto; el corte, un turno abierto o un corte
  // guardado que se esté consultando.
  if (vista === 'pos' && !TURNO.abierto) {
    toast('Abre el turno para empezar a vender.', 'warn');
    vista = 'apertura';
  }
  if (vista === 'pos' && TURNO.modoEdicion) {
    toast('Estás corrigiendo un corte ya cerrado: el punto de venta no está disponible.', 'warn', 6000);
    vista = 'corte';
  }
  if (vista === 'corte' && !TURNO.abierto && !CORTE_MOSTRADO) {
    toast('Abre un turno, o consulta un corte desde el historial.', 'warn');
    vista = 'apertura';
  }

  VISTA = vista;
  // El punto de venta va a sangre y a pantalla completa; el resto, no.
  document.body.classList.toggle('pos-pantalla', vista === 'pos');
  $$('.vista').forEach(v => v.classList.toggle('activa', v.id === `vista-${vista}`));
  $$('#nav-principal .nav-btn').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));

  switch (vista) {
    case 'apertura':   renderApertura(); break;
    case 'pos':        renderPos(); break;
    case 'inventario': renderInventario(); break;
    case 'corte':      renderCorte(); break;
    case 'fiados':     renderFiados(); break;
    case 'reportes':   renderReportes(); break;
    case 'ajustes':    renderAjustes(); break;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/** Estado del turno visible en el encabezado + habilitación del menú. */
function actualizarEstadoGlobal() {
  const badge = document.getElementById('estado-turno');
  if (badge) {
    if (TURNO.modoEdicion) {
      badge.className = 'estado editando';
      badge.innerHTML = `<span class="punto-vivo"></span>
        <div><strong>Corrigiendo un corte</strong>
        <span>${esc(TURNO.cajero)} · ${fechaCorta(TURNO.fecha)}</span></div>`;
    } else if (TURNO.abierto) {
      const pos = totalesPos();
      badge.className = 'estado abierto';
      badge.innerHTML = `<span class="punto-vivo"></span>
        <div><strong>Turno abierto</strong>
        <span>${esc(TURNO.cajero)} · ${esc(TURNO.horario)} · ${fmtNum(pos.numVentas)} ventas</span></div>`;
    } else {
      badge.className = 'estado cerrado';
      badge.innerHTML = `<span class="punto-vivo"></span><div><strong>Turno cerrado</strong>
        <span>Abre un turno para vender</span></div>`;
    }
  }

  $$('#nav-principal .nav-btn').forEach(b => {
    const v = b.dataset.vista;
    const bloqueado = (v === 'pos'   && (!TURNO.abierto || TURNO.modoEdicion)) ||
                      (v === 'corte' && !TURNO.abierto && !CORTE_MOSTRADO);
    b.classList.toggle('bloqueado', bloqueado);
  });
  // Lo que la gente debe, siempre a la vista en el menú
  const badgeFi = document.getElementById('badge-fiados');
  if (badgeFi) {
    const deben = totalPorCobrar();
    badgeFi.textContent = deben > 0 ? fmt(deben) : '';
    // .badge-tab nace oculto: se ve sólo con la clase de color
    badgeFi.className = 'badge-tab' + (deben > 0 ? ' ok' : '');
    badgeFi.title = deben > 0 ? 'Total por cobrar de fiados' : '';
  }

  const btnAp = document.getElementById('nav-apertura');
  if (btnAp) btnAp.lastChild.textContent = TURNO.abierto ? ' Corregir apertura' : ' Apertura';
  show('btn-descartar-turno', TURNO.abierto, 'inline-flex');

  if (TURNO.abierto) actualizarBadgeCuadre();
}

/* ----------------------------------------------------------------- reloj */
function iniciarReloj() {
  const pintar = () => {
    const ahora = new Date();
    setText('reloj-hora', ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
    setText('reloj-fecha', capitalizar(ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })));
  };
  pintar();
  setInterval(pintar, 20000);
}

/* --------------------------------------------------------------- ajustes */
function renderAjustes() {
  setVal('cfg-negocio', CONFIG.negocio);
  setVal('cfg-ticket-pie', CONFIG.ticketPie);
  setVal('cfg-comision', CONFIG.comisionTerminalPct);
  setVal('cfg-rec-cada', CONFIG.recargaCada);
  setVal('cfg-rec-monto', CONFIG.recargaMonto);
  setVal('cfg-com-envio', CONFIG.comisionEnvio);
  document.getElementById('cfg-tc-activa').checked = CONFIG.tarjetaCreditoActiva === true;
  setVal('cfg-tc-alias', CONFIG.tarjetaCreditoAlias);
  setVal('cfg-stockmin', CONFIG.stockMinDefault);
  document.getElementById('cfg-respaldo-auto').checked = CONFIG.respaldoAuto !== false;
  document.getElementById('cfg-sin-stock').checked  = CONFIG.permitirSinStock !== false;

  /* acentos */
  const cont = document.getElementById('cfg-acentos');
  if (cont) {
    cont.innerHTML = Object.entries(ACENTOS).map(([k, a]) => `
      <button class="acento ${CONFIG.acento === k ? 'activo' : ''}" style="--h:${a.hue}"
              onclick="saveConfig({acento:'${k}'}); renderAjustes();" title="${a.nombre}">
        <span></span>${a.nombre}
      </button>`).join('');
  }

  renderListaCajeros();
  renderListaTurnos();
  renderEstadoRespaldo();
  renderAjustesFotos();
  renderEstadoInstalacion();
  setText('aj-version', VERSION_APP);
  // Qué carpeta está sirviendo: delata un servidor viejo de otra carpeta.
  // El mismo aviso confirma que hay servidor local: sólo entonces se puede
  // escribir en disco, así que sólo entonces tiene sentido ofrecer bajar
  // una actualización.
  fetch('__origen', { cache: 'no-store' })
    .then(r => r.ok ? r.text() : null)
    .then(ruta => {
      if (!ruta) return;
      setText('aj-origen', 'Abierta desde: ' + ruta);
      show('aj-remota-wrap', true, 'flex');
    })
    .catch(() => { /* sin servidor: se abrió el archivo directo */ });

  /* uso de almacenamiento, para que nadie se quede sin espacio por sorpresa */
  try {
    const bytes = Object.values(DB).reduce((s, k) => s + (localStorage.getItem(k) || '').length, 0);
    setText('cfg-uso', `${(bytes / 1024).toFixed(0)} KB usados · ${fmtNum(Store.get(DB.cortes, []).length)} cortes · ${fmtNum(getVentas().length)} ventas · ${fmtNum(getProductos().length)} productos`);
  } catch { /* sin métricas si el navegador lo impide */ }
}

function guardarAjustes() {
  const comision = clamp(valOf('cfg-comision', 4.06), 0, 100);
  saveConfig({
    negocio: (document.getElementById('cfg-negocio')?.value || 'Mi negocio').trim() || 'Mi negocio',
    ticketPie: document.getElementById('cfg-ticket-pie')?.value || '',
    comisionTerminalPct: comision,
    recargaCada: Math.max(1, valOf('cfg-rec-cada', 50)),
    recargaMonto: Math.max(0, valOf('cfg-rec-monto', 2)),
    comisionEnvio: Math.max(0, valOf('cfg-com-envio', 15)),
    tarjetaCreditoActiva: !!document.getElementById('cfg-tc-activa')?.checked,
    tarjetaCreditoAlias: (document.getElementById('cfg-tc-alias')?.value || '').trim(),
    stockMinDefault: Math.max(0, valOf('cfg-stockmin', 5)),
    permitirSinStock: !!document.getElementById('cfg-sin-stock')?.checked,
    respaldoAuto: !!document.getElementById('cfg-respaldo-auto')?.checked,
  });
  setText('marca-negocio', CONFIG.negocio);
  document.title = `${CONFIG.negocio} · Punto de venta y corte de caja`;
  const marca = document.getElementById('marca-negocio');
  if (marca) marca.title = 'EL TANICHI · versión ' + VERSION_APP;
  if (TURNO.abierto) renderCorte();
  toast('Ajustes guardados.', 'success');
}

/* --- cajeros */
function renderListaCajeros() {
  const cont = document.getElementById('cfg-cajeros');
  if (!cont) return;
  cont.innerHTML = (CONFIG.cajeros || []).map((c, i) => `
    <div class="concepto">
      <input class="input" value="${esc(c)}" oninput="editarCajero(${i}, this.value)" aria-label="Nombre del cajero"/>
      <button class="btn-icono peligro" onclick="quitarCajero(${i})" title="Quitar">✕</button>
    </div>`).join('') || `<p class="hint">Sin responsables configurados.</p>`;
}

function agregarCajero() { CONFIG.cajeros.push('Nuevo responsable'); saveConfig({}); renderListaCajeros(); }
function editarCajero(i, v) { CONFIG.cajeros[i] = v; saveConfig({}); }
function quitarCajero(i) {
  if (CONFIG.cajeros.length <= 1) { toast('Debe quedar al menos un responsable.', 'warn'); return; }
  CONFIG.cajeros.splice(i, 1); saveConfig({}); renderListaCajeros();
}

/* --- turnos */
function renderListaTurnos() {
  const cont = document.getElementById('cfg-turnos');
  if (!cont) return;
  cont.innerHTML = (CONFIG.turnos || []).map((t, i) => `
    <div class="concepto turno-cfg">
      <input class="input" value="${esc(t.horario)}" placeholder="8:00 a 11:00"
             oninput="editarTurno(${i}, 'horario', this.value)" aria-label="Horario"/>
      <input class="input" value="${esc(t.cajero)}" placeholder="Responsable" list="dl-cajeros"
             oninput="editarTurno(${i}, 'cajero', this.value)" aria-label="Responsable"/>
      <button class="btn-icono peligro" onclick="quitarTurno(${i})" title="Quitar">✕</button>
    </div>`).join('') || `<p class="hint">Sin turnos configurados.</p>`;
}

function agregarTurno() {
  CONFIG.turnos.push({ horario: '', cajero: CONFIG.cajeros[0] || '' });
  saveConfig({}); renderListaTurnos();
}
function editarTurno(i, campo, v) { CONFIG.turnos[i][campo] = v; saveConfig({}); }
function quitarTurno(i) { CONFIG.turnos.splice(i, 1); saveConfig({}); renderListaTurnos(); }

/* --------------------------------------------------- borrado total (rojo) */
async function borrarTodo() {
  const ok = await confirmar({
    titulo: 'Borrar todos los datos',
    mensaje: `Se eliminarán <strong>cortes, ventas, productos, ajustes y el turno abierto</strong>.<br>
              El sistema quedará como recién instalado.<br><br>
              <strong>Descarga primero un respaldo.</strong> Esta acción no se puede deshacer.`,
    ok: 'Borrar todo', peligro: true,
  });
  if (!ok) return;
  const ok2 = await confirmar({
    titulo: '¿Seguro?',
    mensaje: 'Última confirmación: se perderá toda la información guardada en esta computadora.',
    ok: 'Sí, borrar definitivamente', peligro: true,
  });
  if (!ok2) return;
  Object.values(DB).forEach(k => Store.remove(k));
  location.reload();
}

/* -------------------------------------------------------------- atajos */
function iniciarAtajos() {
  document.addEventListener('keydown', (e) => {
    const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

    if (e.key === 'Escape') { cerrarModalesAbiertos(); return; }

    // Teclas de caja; funcionan aunque se esté escribiendo en un campo.
    // F11 y F12 se las reserva el navegador (pantalla completa y herramientas
    // de desarrollo). Se atienden igual, y F2 y F4 quedan como equivalentes
    // garantizados por si el navegador se queda con la tecla.
    // F11 se la deja al navegador para su pantalla completa: aquí sólo F2.
    if (e.key === 'F2' && VISTA === 'pos') {
      e.preventDefault();
      const b = document.getElementById('pos-buscar');
      if (b) { b.focus(); b.select(); }
      return;
    }
    if ((e.key === 'F12' || e.key === 'F4') && VISTA === 'pos') { e.preventDefault(); abrirCobro(); return; }
    if (e.key === 'F9' && VISTA === 'pos') { e.preventDefault(); nuevoTicket(); return; }
    if (e.key === 'F3' && VISTA === 'pos') { e.preventDefault(); abrirConsulta(); return; }
    if (e.key === 'F8') { e.preventDefault(); alternarCompacta(); return; }

    // Con Alt no chocan con el buscador automático de abajo
    if (e.altKey && VISTA === 'pos') {
      const k = e.key.toLowerCase();
      if (k === 'v') { e.preventDefault(); abrirVentaLibre(); return; }
      if (k === 'r') { e.preventDefault(); abrirRecarga();    return; }
      if (k === 'd') { e.preventDefault(); abrirBuscarVenta(); return; }
      if (k === 'e') { e.preventDefault(); abrirEgreso();      return; }
      if (k === 't') { e.preventDefault(); abrirEnvio();       return; }
    }

    if (enCampo) return;

    /* ---- El lector de código de barras escribe como si fuera un teclado.
       En el punto de venta, cualquier carácter salta solo al buscador: así
       se pasa producto tras producto sin tener que apuntar con el ratón ni
       pulsar F2 cada vez. Fuera del POS no se toca nada. */
    if (VISTA === 'pos' && e.key.length === 1 &&
        !e.ctrlKey && !e.altKey && !e.metaKey &&
        !$$('.modal-overlay.visible').length) {
      const b = document.getElementById('pos-buscar');
      if (b && document.activeElement !== b) {
        b.value = '';          // cada escaneo empieza limpio, no se encadena
        POS.busqueda = '';
        b.focus();             // el carácter cae ya dentro del campo
        return;
      }
    }

    if (e.key.toLowerCase() === 'h') { abrirHistorial(); return; }
  });
}

/* ------------------------------------------------------------- arranque */
/* ------------------------------------------------------ modo compacto ---
   Achica la barra de arriba para dejarle la pantalla a los productos. Útil
   en el monitor chico del mostrador. Se recuerda entre sesiones.
   (Minimizar la ventana en sí lo hace Windows, con su botón del título:
   una página web no puede minimizarse sola.) */
/* ---------------------------------------------------- pantalla completa ---
   El botón de la esquina. Aprovecha toda la pantalla del mostrador y de paso
   achica la barra de arriba, que es lo que se busca al ponerla completa. */
async function alternarPantallaCompleta() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (e) {
    toast('Este navegador no dejó cambiar a pantalla completa. Usa la tecla F11.', 'warn', 6000);
  }
}

/** El navegador avisa cuando entra o sale, incluso si fue con F11. */
document.addEventListener('fullscreenchange', () => {
  const completa = !!document.fullscreenElement;
  alternarCompacta(completa);
  pintarBotonPantalla();
});

function pintarBotonPantalla() {
  const b = document.getElementById('btn-pantalla');
  if (!b) return;
  const completa = !!document.fullscreenElement;
  b.innerHTML = icono(completa ? 'bajar' : 'subir', 20);
  b.title = completa ? 'Salir de pantalla completa' : 'Pantalla completa';
}

function alternarCompacta(forzar) {
  const activa = forzar === undefined ? !document.body.classList.contains('compacta') : !!forzar;
  document.body.classList.toggle('compacta', activa);
  saveConfig({ compacta: activa });
  pintarBotonCompactar();
}

function pintarBotonCompactar() {
  const b = document.getElementById('btn-compactar');
  if (!b) return;   // el botón de la esquina ahora es pantalla completa
  const activa = document.body.classList.contains('compacta');
  b.innerHTML = icono(activa ? 'bajar' : 'subir', 20);
  b.title = activa
    ? 'Volver a la barra normal (tecla F8)'
    : 'Achicar la barra de arriba para ver más productos (tecla F8)';
}

/* ------------------------------------------------------------- versión ---
   Visible en Ajustes. Sirve para saber de un vistazo si el equipo está
   corriendo la copia nueva o una guardada de antes. */
const VERSION_APP = '27';

/**
 * Se cura sola cuando quedó una copia vieja guardada.
 *
 * index.html se lee siempre del servidor, así que su <meta> trae el número
 * nuevo. Este archivo, en cambio, puede venir de la copia guardada. Si los
 * dos números no coinciden, lo que está corriendo es viejo: se borra la
 * copia y se recarga. Una sola vez, para no entrar en un ciclo.
 */
/**
 * Borra la copia guardada para trabajar sin internet y recarga desde el
 * servidor. La usan las tres formas de actualizar: la reparación automática,
 * el botón manual, y la actualización descargada de GitHub.
 *
 * Hace falta porque esa copia se guarda por dirección (localhost:8123), no
 * por carpeta: si reemplazas los archivos pero la dirección es la misma, el
 * navegador puede seguir sirviendo la copia vieja hasta que se le ordene
 * tirarla. Los datos —ventas, inventario, fiados, fotos— no se tocan: viven
 * aparte, en el almacenamiento del navegador, no en estos archivos.
 */
async function limpiarCopiaYRecargar() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const claves = await caches.keys();
      await Promise.all(claves.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.warn('No se pudo limpiar la copia guardada', e);
  }
  // El parámetro obliga a saltarse cualquier caché intermedia
  location.replace(location.pathname + '?nuevo=' + Date.now());
}

async function repararSiEstaVieja() {
  const meta = document.querySelector('meta[name="tanichi-version"]');
  const esperada = meta && meta.getAttribute('content');
  if (!esperada || esperada === VERSION_APP) return false;

  const YA = 'tanichi.reparando';
  if (sessionStorage.getItem(YA) === esperada) {
    // Ya se intentó y sigue sin cuadrar: mejor avisar que recargar sin fin
    toast(`La app quedó en la versión ${VERSION_APP} y debería ser la ${esperada}. ` +
          `Cierra la app por completo y vuelve a abrirla.`, 'error', 12000);
    return false;
  }
  try { sessionStorage.setItem(YA, esperada); } catch { /* modo privado */ }

  await limpiarCopiaYRecargar();
  return true;
}

/** Botón manual de Ajustes: por si la reparación automática no bastó. */
async function forzarActualizacion() {
  const ok = await confirmar({
    titulo: 'Buscar una versión nueva',
    mensaje: `Se borra la copia guardada del programa y se vuelve a leer del servidor.<br><br>
              <strong>Tus datos no se tocan</strong>: ventas, inventario, fiados y fotos
              se guardan aparte y quedan igual.`,
    ok: 'Actualizar ahora',
  });
  if (!ok) return;
  toast('Copia borrada. Recargando…', 'info', 2500);
  setTimeout(limpiarCopiaYRecargar, 700);
}

/* ------------------------------------------- actualizar desde GitHub -----
   A diferencia de lo anterior —que sólo tira la copia vieja de LOS MISMOS
   archivos—, esto baja archivos NUEVOS: la última versión publicada en el
   repositorio, y reemplaza el programa en este equipo. Sólo funciona servida
   por el servidor local (necesita su ayuda para escribir en disco); en el
   enlace publicado o abierta como archivo suelto, el botón no aparece. */
const REPO_ACTUALIZACIONES = 'Junsa64/TANICHI';

async function buscarActualizacionRemota() {
  const btn = document.getElementById('btn-actualizar-remota');
  const estado = document.getElementById('aj-remota-estado');
  if (btn) btn.disabled = true;
  if (estado) { estado.className = 'hint'; estado.textContent = 'Buscando en línea…'; }

  let remota;
  try {
    const url = `https://raw.githubusercontent.com/${REPO_ACTUALIZACIONES}/main/index.html?t=${Date.now()}`;
    const html = await fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.text() : Promise.reject(r.status));
    const m = html.match(/name="tanichi-version"\s+content="(\d+)"/);
    if (!m) throw new Error('sin versión en la respuesta');
    remota = m[1];
  } catch (e) {
    if (estado) { estado.className = 'hint malo'; estado.textContent = 'No se pudo revisar. ¿Hay internet?'; }
    if (btn) btn.disabled = false;
    return;
  }

  if (Number(remota) <= Number(VERSION_APP)) {
    if (estado) { estado.className = 'hint bueno'; estado.textContent = `Ya tienes la última versión (v${VERSION_APP}).`; }
    if (btn) btn.disabled = false;
    return;
  }

  const ok = await confirmar({
    titulo: 'Actualización disponible',
    mensaje: `Hay una versión nueva: <strong>v${remota}</strong> · tienes v${VERSION_APP}.<br><br>
              Se descarga del repositorio y se reemplazan los archivos del programa.
              <strong>Tus datos no se tocan.</strong>`,
    ok: 'Actualizar ahora',
  });
  if (!ok) { if (btn) btn.disabled = false; if (estado) estado.textContent = ''; return; }

  if (estado) estado.textContent = 'Descargando…';
  try {
    const r = await fetch('__actualizar', { method: 'POST' });
    const texto = await r.text();
    if (!r.ok || !texto.startsWith('ok')) throw new Error(texto || String(r.status));
  } catch (e) {
    if (estado) { estado.className = 'hint malo'; estado.textContent = 'No se pudo descargar: ' + e.message; }
    if (btn) btn.disabled = false;
    return;
  }

  toast(`Actualizado a v${remota}. Reiniciando…`, 'success', 3000);
  setTimeout(limpiarCopiaYRecargar, 900);
}

/* ------------------------------------------------- instalar como app ----
   Sólo aplica servida por http(s) y desde archivos sueltos. En el enlace
   publicado el visor no permite registrar un trabajador de servicio; ahí la
   app funciona igual, sólo que sin el guardado para trabajar sin internet. */
function registrarServicio() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (!document.querySelector('link[rel="manifest"]')) return;   // versión de un solo archivo

  navigator.serviceWorker.register('sw.js').then(reg => {
    // Si hay una versión nueva esperando, se avisa en vez de cambiarla a media venta
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Hay una versión nueva. Cierra y vuelve a abrir la app para usarla.', 'info', 9000);
        }
      });
    });
  }).catch(() => { /* sin caché offline: la app sigue sirviendo igual */ });
}

/** ¿Está corriendo como app instalada y no como pestaña del navegador? */
function esAppInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: window-controls-overlay)').matches ||
         navigator.standalone === true;
}

/* Chrome avisa cuando se puede instalar: guardamos el aviso para ofrecerlo
   desde Ajustes en lugar de dejarlo pasar. */
let _instalador = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _instalador = e;
  renderEstadoInstalacion();
});
window.addEventListener('appinstalled', () => {
  _instalador = null;
  renderEstadoInstalacion();
  toast('Aplicación instalada. Ábrela desde el escritorio o el menú de inicio.', 'success', 7000);
});

async function instalarApp() {
  if (!_instalador) return;
  _instalador.prompt();
  const r = await _instalador.userChoice.catch(() => null);
  if (r && r.outcome === 'accepted') _instalador = null;
  renderEstadoInstalacion();
}

function renderEstadoInstalacion() {
  const caja = document.getElementById('aj-instalar');
  if (!caja) return;
  const btn = document.getElementById('btn-instalar');
  const txt = document.getElementById('aj-instalar-txt');

  if (esAppInstalada()) {
    if (txt) txt.innerHTML = `<strong>Ya la estás usando como aplicación.</strong>
      <span class="hint">Se abre en su propia ventana, sin barra de navegador.</span>`;
    show('btn-instalar', false);
  } else if (_instalador) {
    if (txt) txt.innerHTML = `<strong>Se puede instalar en este equipo.</strong>
      <span class="hint">Queda con su ícono en el escritorio y abre sin internet.</span>`;
    show('btn-instalar', true, 'inline-flex');
  } else {
    const local = location.protocol === 'file:';
    if (txt) txt.innerHTML = local
      ? `<strong>Ábrela con el acceso <em>TANICHI</em> del escritorio.</strong>
         <span class="hint">Como archivo suelto el navegador no permite instalarla;
         desde ese acceso sí, y además guarda la app para trabajar sin internet.</span>`
      : `<strong>Instálala desde el menú del navegador.</strong>
         <span class="hint">En el celular: <em>Agregar a pantalla de inicio</em>.
         En la computadora, Chrome o Edge la ofrecen en el menú ⋮ cuando está disponible;
         la instalación completa, con uso sin internet, viene del acceso <em>TANICHI</em>.</span>`;
    show('btn-instalar', false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Antes que nada: si lo que corre es una copia vieja, se repara y recarga
  if (await repararSiEstaVieja()) return;

  try {
    loadConfig();
    aplicarTema();
    migrarDatosAnteriores();
    cargarTurno();
  } catch (e) {
    console.error('Error al iniciar', e);
    toast('Hubo un problema al leer los datos guardados. Revisa Ajustes → Respaldos.', 'error', 9000);
  }

  setText('marca-negocio', CONFIG.negocio);
  const _v = document.getElementById('cab-version');
  if (_v) _v.textContent = 'v' + VERSION_APP;
  const _m = document.getElementById('marca-negocio');
  if (_m) _m.title = 'EL TANICHI · versión ' + VERSION_APP;
  document.title = `${CONFIG.negocio} · Punto de venta y corte de caja`;
  const btnTema = document.getElementById('btn-tema');
  if (btnTema) btnTema.innerHTML = icono(CONFIG.tema === 'claro' ? 'luna' : 'sol', 20);
  document.body.classList.toggle('compacta', CONFIG.compacta === true);
  pintarBotonCompactar();

  pintarIconos();          // rellena los <span data-ico> del HTML estático
  iniciarReloj();
  iniciarAtajos();
  activarCamposCalculadora(document);
  refrescarDatalists();
  actualizarEstadoGlobal();

  // Los accesos directos de la app instalada entran con ?ir=pos, ?ir=corte…
  const pedida = new URLSearchParams(location.search).get('ir');
  const permitida = ['pos', 'corte', 'fiados', 'inventario', 'reportes', 'apertura'].includes(pedida);
  irA(permitida ? pedida : (TURNO.abierto ? 'pos' : 'apertura'));
  renderEstadoRespaldo();
  registrarServicio();

  // Guardado periódico de seguridad mientras el turno está abierto
  setInterval(() => { if (TURNO.abierto) guardarTurno({ inmediato: true }); }, 30000);

  // Si el usuario cierra la ventana con datos sin volcar, se guardan ya
  window.addEventListener('beforeunload', () => { if (TURNO.abierto) guardarTurno({ inmediato: true }); });

  // Dos pestañas abiertas a la vez pisarían los datos: se avisa y se recarga
  window.addEventListener('storage', (e) => {
    // Si otra pestaña cambió catálogo o ventas, lo que tenemos en memoria
    // ya no sirve: se suelta para volver a leerlo del almacén.
    if (e.key === DB.productos) invalidarProductos();
    if (e.key === DB.ventas)    { invalidarVentas(); invalidarTopVendidos(); }
    if (e.key === DB.turno && document.visibilityState !== 'visible') location.reload();
  });

  console.info('TANICHI listo · POS + corte de caja');
});

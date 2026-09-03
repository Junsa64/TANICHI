/* ============================================================================
   TANICHI · TURNO
   Es la pieza que une el POS con el Corte de Caja: un único turno abierto,
   compartido por los dos módulos. El POS registra ventas contra el turno y
   el corte las lee ya sumadas. No hay doble captura.
   ========================================================================== */

/* ------------------------------------------------------- denominaciones */
const DENOMINACIONES = [
  { valor: 500, label: 'Billete $500', tipo: 'billete' },
  { valor: 200, label: 'Billete $200', tipo: 'billete' },
  { valor: 100, label: 'Billete $100', tipo: 'billete' },
  { valor: 50,  label: 'Billete $50',  tipo: 'billete' },
  { valor: 20,  label: 'Billete $20',  tipo: 'billete' },
  { valor: 10,  label: 'Moneda $10',   tipo: 'moneda'  },
  { valor: 5,   label: 'Moneda $5',    tipo: 'moneda'  },
  { valor: 2,   label: 'Moneda $2',    tipo: 'moneda'  },
  { valor: 1,   label: 'Moneda $1',    tipo: 'moneda'  },
  { valor: 0.5, label: 'Moneda $0.50', tipo: 'moneda'  },
];

const METODOS_PAGO = {
  efectivo:      { label: 'Efectivo',      icono: 'billete'  },
  tarjeta:       { label: 'Tarjeta',       icono: 'tarjeta'  },
  transferencia: { label: 'Transferencia', icono: 'telefono' },
  credito:       { label: 'Fiado',         icono: 'personas' },
};

/* ------------------------------------------------------- turno en curso */
/** Convierte "8:00 a 11:00" (o "8:00-11:00") en minutos desde medianoche. */
function rangoHorario(txt) {
  const m = String(txt || '').match(/(\d{1,2}):(\d{2})/g);
  if (!m || m.length < 2) return null;
  const [ini, fin] = m.slice(0, 2).map(x => {
    const [h, mm] = x.split(':').map(Number);
    return h * 60 + mm;
  });
  return { ini, fin };
}

/**
 * El turno que corresponde a este momento. Primero busca uno que contenga la
 * hora actual; si ninguno la contiene —son las 3 de la tarde y los turnos son
 * de mañana— devuelve el más cercano, para no proponer siempre el primero.
 */
function turnoDeLaHora(cuando = new Date()) {
  const turnos = (CONFIG.turnos || []).filter(t => t && t.horario);
  if (!turnos.length) return null;
  const ahora = cuando.getHours() * 60 + cuando.getMinutes();

  const dentro = turnos.find(t => {
    const r = rangoHorario(t.horario);
    if (!r) return false;
    // Un turno que cruza la medianoche (21:00 a 2:00) parte el día en dos
    return r.fin > r.ini ? (ahora >= r.ini && ahora < r.fin)
                         : (ahora >= r.ini || ahora < r.fin);
  });
  if (dentro) return dentro;

  // El más cercano a su hora de inicio, contando la vuelta del reloj
  let mejor = null, menor = Infinity;
  turnos.forEach(t => {
    const r = rangoHorario(t.horario);
    if (!r) return;
    const bruta = Math.abs(ahora - r.ini);
    const d = Math.min(bruta, 1440 - bruta);
    if (d < menor) { menor = d; mejor = t; }
  });
  return mejor;
}

function turnoVacio() {
  // Arranca en el turno que toca por el reloj, no en el primero de la lista
  const s = turnoDeLaHora();
  return {
    id: null,
    abierto: false,
    cajero: (s && s.cajero) || (CONFIG.cajeros && CONFIG.cajeros[0]) || 'Cajero',
    fecha: hoyISO(),
    horario: (s && s.horario) || (CONFIG.turnos && CONFIG.turnos[0] && CONFIG.turnos[0].horario) || '',
    // Mientras nadie elija a mano, el horario sigue a la hora del día
    horarioAuto: true,
    notas: '',
    inicio: null,

    aperturaModo: 'conteo',              // 'conteo' | 'rapido'
    piezasApertura: {},
    fondoRapido: 0,
    fondoApertura: 0,
    mpInicial: 0,
    carteraInicial: 0,
    tcInicial: 0,                        // lo que ya debías de la tarjeta al abrir
    tcCierre: 0,

    cierreModo: 'conteo',
    piezasCierre: {},
    cierreRapido: 0,

    // Tickets apartados: el cliente se fue por algo más y se atiende al
    // siguiente sin perder su carrito. Viven en el turno para que aguanten
    // un cierre de ventana, y se van con él.
    tickets: [],             // [{ id, carrito, descuento, creado }] en orden fijo
    ticketActivo: null,      // id del que se está cobrando
    ticketsPendientes: [],   // formato anterior; se convierte al cargar

    // Ingresos capturados a mano (ventas que no pasaron por el POS)
    manual: { ventaEfectivo: 0, transferencia: 0, tarjeta: 0, pagoCreditos: 0, creditoClientes: 0, recargas: 0 },
    otrosIngresos: [],                   // [{ id, desc, monto }]

    // Al reabrir un corte guardado, sus importes ya están congelados en
    // `manual`: el POS deja de sumar para no contarlos dos veces.
    modoEdicion: false,
    posOriginal: null,

    // Salidas de efectivo
    compras: [], proveedores: [], servicios: [], honorarios: [], gastos: [], otrosEgresos: [],

    dotacion: 0,                         // heredado: efectivo de caja a cartera
    traspasos: [],                       // [{ id, origen, destino, monto, desc, hora }]
    carteraCierre: 0,
    mpRetiros: 0,
    mpCierre: 0,

    obs: '',
    editandoCorteId: null,
    lastSaved: null,
  };
}

let TURNO = turnoVacio();

function cargarTurno() {
  const guardado = Store.get(DB.turno, null);
  TURNO = guardado ? { ...turnoVacio(), ...guardado } : turnoVacio();
  // Blindaje: si algún arreglo llegó corrupto, se restaura vacío en vez de romper
  ['otrosIngresos', 'compras', 'proveedores', 'servicios', 'honorarios', 'gastos', 'otrosEgresos',
   'ticketsPendientes', 'tickets'].forEach(k => {
    if (!Array.isArray(TURNO[k])) TURNO[k] = [];
  });
  if (!TURNO.manual || typeof TURNO.manual !== 'object') TURNO.manual = turnoVacio().manual;
  if (!TURNO.piezasApertura || typeof TURNO.piezasApertura !== 'object') TURNO.piezasApertura = {};
  if (!TURNO.piezasCierre  || typeof TURNO.piezasCierre  !== 'object') TURNO.piezasCierre  = {};
  return TURNO;
}

let _guardarTimer = null;
function guardarTurno({ inmediato = false } = {}) {
  TURNO.lastSaved = Date.now();
  const escribir = () => {
    Store.set(DB.turno, TURNO);
    marcarGuardado();
  };
  if (inmediato) { clearTimeout(_guardarTimer); escribir(); return; }
  clearTimeout(_guardarTimer);
  _guardarTimer = setTimeout(escribir, 400);   // agrupa ráfagas de tecleo
}

function marcarGuardado() {
  const el = document.getElementById('indicador-guardado');
  if (!el) return;
  el.classList.add('activo');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('activo'), 1800);
}

/* --------------------------------------------------------------- ventas */
/* Igual que el catálogo: las ventas se recuerdan ya interpretadas. Sin esto,
   cada venta disparaba varias relecturas completas del historial. */
let _ventas = null;
function getVentas() {
  if (_ventas === null) _ventas = Store.get(DB.ventas, []);
  return _ventas;
}
function setVentas(v) {
  _ventas = v;
  Store.set(DB.ventas, v);
  invalidarTopVendidos();
}
function invalidarVentas() { _ventas = null; }

/** Ventas válidas (no canceladas) del turno abierto. */
function ventasDelTurno(turnoId = TURNO.id) {
  if (!turnoId) return [];
  return getVentas().filter(v => v.turnoId === turnoId && !v.cancelada);
}

/** Siguiente folio sin consumirlo, para mostrarlo en el ticket en curso. */
function folioEnCurso() {
  return num(Store.get(DB.ui, {}).folio, 0) + 1;
}

function siguienteFolio() {
  const ui = Store.get(DB.ui, {});
  const n = num(ui.folio, 0) + 1;
  ui.folio = n;
  Store.set(DB.ui, ui);
  return n;
}

/** Suma los pagos de un método concreto dentro de una lista de ventas. */
function sumaPagos(ventas, metodo) {
  return redondear(ventas.reduce((s, v) =>
    s + (v.pagos || []).reduce((t, p) => t + (p.metodo === metodo ? num(p.monto) : 0), 0), 0));
}

function posEnCero() {
  return {
    numVentas: 0, numRecargas: 0, numAbonos: 0, numDevoluciones: 0,
    efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0,
    abonosEfectivo: 0, abonosTransfer: 0,
    recargas: 0, devuelto: 0, totalVendido: 0, piezas: 0,
    numEnvios: 0, enviado: 0, comisionEnvios: 0, envioPorCuenta: { mp: 0, cartera: 0, caja: 0 },
  };
}

/** Todo lo que el POS aportó al turno, ya clasificado. */
function totalesPos(turnoId = TURNO.id) {
  // En modo edición los importes viven en la captura manual: si el POS
  // volviera a sumarlos, cada corte editado se duplicaría.
  if (TURNO.modoEdicion) return posEnCero();
  const todas    = ventasDelTurno(turnoId);
  const ventas   = todas.filter(v => v.tipo === 'venta');
  const recargas = todas.filter(v => v.tipo === 'recarga');
  const abonos   = todas.filter(v => v.tipo === 'abono');
  // Una devolución es dinero que sale por donde entró: se resta del método
  // con el que se reembolsó, no se borra la venta original.
  const devols   = todas.filter(v => v.tipo === 'devolucion');
  /* Envíos de dinero: transfieres tú desde tu cuenta, el cliente te paga en
     efectivo el monto más la comisión. Baja la cuenta de la que saliste y
     sube la caja; la comisión es lo único que ganas. */
  const envios   = todas.filter(v => v.tipo === 'envio');

  const neto = (metodo) => redondear(sumaPagos(ventas, metodo) - sumaPagos(devols, metodo));

  const envioPorCuenta = { mp: 0, cartera: 0, caja: 0 };
  envios.forEach(v => {
    const cta = CUENTAS[v.cuentaOrigen] ? v.cuentaOrigen : 'mp';
    envioPorCuenta[cta] += num(v.montoEnviado);
  });
  Object.keys(envioPorCuenta).forEach(k => { envioPorCuenta[k] = redondear(envioPorCuenta[k]); });

  return {
    numEnvios:      envios.length,
    enviado:        redondear(envios.reduce((s, v) => s + num(v.montoEnviado), 0)),
    comisionEnvios: redondear(envios.reduce((s, v) => s + num(v.comision), 0)),
    envioPorCuenta,
    numVentas:      ventas.length,
    numRecargas:    recargas.length,
    numAbonos:      abonos.length,
    numDevoluciones: devols.length,
    efectivo:       neto('efectivo'),
    tarjeta:        neto('tarjeta'),
    transferencia:  neto('transferencia'),
    credito:        neto('credito'),
    // Los abonos a cuenta pueden cobrarse en efectivo o por transferencia
    abonosEfectivo: sumaPagos(abonos, 'efectivo'),
    abonosTransfer: sumaPagos(abonos, 'transferencia'),
    recargas:       redondear(recargas.reduce((s, v) => s + num(v.total), 0)),
    devuelto:       redondear(devols.reduce((s, v) => s + num(v.total), 0)),
    totalVendido:   redondear(ventas.reduce((s, v) => s + num(v.total), 0) -
                              devols.reduce((s, v) => s + num(v.total), 0)),
    piezas:         ventas.reduce((s, v) => s + (v.items || []).reduce((t, i) => t + num(i.cantidad), 0), 0) -
                    devols.reduce((s, v) => s + (v.items || []).reduce((t, i) => t + num(i.cantidad), 0), 0),
  };
}

/* ----------------------------------------------------- conteo de efectivo */
function totalPiezas(piezas) {
  return redondear(DENOMINACIONES.reduce((s, d) => s + num(piezas[d.valor]) * d.valor, 0));
}

function fondoDeApertura() {
  return TURNO.aperturaModo === 'rapido'
    ? redondear(TURNO.fondoRapido)
    : totalPiezas(TURNO.piezasApertura);
}

function efectivoContado() {
  return TURNO.cierreModo === 'rapido'
    ? redondear(TURNO.cierreRapido)
    : totalPiezas(TURNO.piezasCierre);
}

/* ------------------------------------------------------------- egresos */
function sumaLista(lista) {
  return redondear((lista || []).reduce((s, x) => s + num(x.monto), 0));
}

function totalEgresos() {
  return redondear(sumaLista(TURNO.compras) + sumaLista(TURNO.proveedores) +
                   sumaLista(TURNO.servicios) + sumaLista(TURNO.honorarios) +
                   sumaLista(TURNO.gastos) + sumaLista(TURNO.otrosEgresos));
}

/* ================================================ LAS TRES CUENTAS =======
   El dinero de la tienda vive en tres lugares y se mueve entre ellos. Un
   egreso sale de UNO de los tres; un traspaso saca de uno y mete en otro,
   sin que la tienda gane ni pierda nada.
   ====================================================================== */

const CUENTAS = {
  caja:    { label: 'Caja',         largo: 'Caja (efectivo)', icono: 'billete'  },
  cartera: { label: 'Cartera',      largo: 'Cartera',         icono: 'banco'    },
  mp:      { label: 'Mercado Pago', largo: 'Mercado Pago',    icono: 'telefono' },
  // La tarjeta de crédito del dueño, ligada a su cuenta de Mercado Pago —no
  // una forma de cobro a clientes—. No guarda dinero: guarda deuda. Comprar
  // con ella la sube; pagarla la baja. El alias se ajusta en Ajustes y se
  // aplica aquí mismo, así que el resto del código nunca necesita saberlo.
  tc:      { label: 'T. Crédito',   largo: 'Tarjeta de crédito', icono: 'tarjeta', deuda: true },
};

/** El alias configurado en Ajustes reemplaza el nombre por defecto en todos
 *  lados: botones, corte, reportes. Se llama al cargar y al guardar Ajustes. */
function aplicarAliasTarjetaCredito() {
  const alias = String(CONFIG.tarjetaCreditoAlias || '').trim();
  CUENTAS.tc.label = alias || 'T. Crédito';
  CUENTAS.tc.largo = alias || 'Tarjeta de crédito';
}

/** Próxima fecha en que cae el día `dia` (1-31) del mes, a partir de hoy. */
function proximaFechaTC(dia) {
  dia = Math.round(num(dia));
  if (!dia || dia < 1) return null;
  dia = Math.min(dia, 31);
  const diasEnMes = (a, m) => new Date(a, m + 1, 0).getDate();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let anio = hoy.getFullYear(), mes = hoy.getMonth();
  let f = new Date(anio, mes, Math.min(dia, diasEnMes(anio, mes)));
  if (f < hoy) {
    mes += 1; if (mes > 11) { mes = 0; anio += 1; }
    f = new Date(anio, mes, Math.min(dia, diasEnMes(anio, mes)));
  }
  return f;
}

function diasRestantesTexto(f) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((f - hoy) / 86400000);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

/** Pinta en `elId` cuándo caen el próximo corte y pago de la tarjeta,
    según lo configurado en Ajustes. Se usa ahí y en Corte → Saldos. */
function renderProximasFechasTC(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const corte = proximaFechaTC(CONFIG.tarjetaCreditoDiaCorte);
  const pago  = proximaFechaTC(CONFIG.tarjetaCreditoDiaPago);
  if (!corte && !pago) { el.textContent = ''; return; }
  const partes = [];
  if (corte) partes.push(`Próximo corte: <strong>${fechaCorta(hoyISO(corte))}</strong> (${diasRestantesTexto(corte)})`);
  if (pago)  partes.push(`Próximo pago: <strong>${fechaCorta(hoyISO(pago))}</strong> (${diasRestantesTexto(pago)})`);
  el.innerHTML = partes.join(' · ');
}

const LISTAS_DE_EGRESO = ['compras', 'proveedores', 'servicios', 'honorarios', 'gastos', 'otrosEgresos'];

/** Cuenta de la que sale un egreso. Lo capturado antes no la traía: era caja. */
function cuentaDeEgreso(item) {
  return CUENTAS[item && item.origen] ? item.origen : 'caja';
}

/** Cuánto sale de cada cuenta por egresos (comprar con la tarjeta cuenta como
 *  salida de la cuenta 'tc', aunque ahí lo que sube es deuda, no lo que baja
 *  es saldo). */
function egresosPorCuenta(t = TURNO) {
  const r = { caja: 0, cartera: 0, mp: 0, tc: 0 };
  LISTAS_DE_EGRESO.forEach(k => {
    (t[k] || []).forEach(x => { r[cuentaDeEgreso(x)] += num(x.monto); });
  });
  Object.keys(r).forEach(k => { r[k] = redondear(r[k]); });
  return r;
}

/** Efecto neto de los traspasos en cada cuenta: lo que entra menos lo que sale.
 *  Para 'tc' un traspaso entrante es un PAGO a la tarjeta: baja la deuda, así
 *  que calcularCuadre() lo resta en vez de sumarlo (ver esperadoTC). */
function traspasosPorCuenta(lista) {
  const r = { caja: 0, cartera: 0, mp: 0, tc: 0 };
  (lista || []).forEach(t => {
    const m = num(t.monto);
    if (CUENTAS[t.origen])  r[t.origen]  -= m;
    if (CUENTAS[t.destino]) r[t.destino] += m;
  });
  Object.keys(r).forEach(k => { r[k] = redondear(r[k]); });
  return r;
}

function totalTraspasos(lista = TURNO.traspasos) {
  return redondear((lista || []).reduce((s, t) => s + num(t.monto), 0));
}

/* ================================================================= CUADRE
   Un único lugar donde se calcula el cuadre. El tab de Cuadre, el reporte,
   el TXT y el historial leen todos de aquí: no pueden contradecirse.
   ====================================================================== */
function calcularCuadre(fuente = null) {
  const c = fuente || snapshotTurno();

  const ingEfectivo   = redondear(num(c.ventaEfectivo) + num(c.pagoCreditos) + num(c.otrosIngresos));
  const egresos       = num(c.egresos);
  const recargas      = num(c.totalRecargas);
  const comisionRec   = num(c.comisionRecargas);

  /* Egresos repartidos por cuenta y traspasos entre cuentas. Un corte
     guardado antes de que esto existiera no trae ninguno de los dos: sus
     egresos eran todos de caja y su único movimiento, la dotación. Por eso
     `dotacion` y `mpRetiros` se siguen leyendo y dan el mismo resultado. */
  const egr      = c.egresosPorCuenta || { caja: egresos, cartera: 0, mp: 0, tc: 0 };
  const tras     = traspasosPorCuenta(c.traspasos);
  const dotacion = num(c.dotacion);          // heredado: caja → cartera

  /* Envíos de dinero: el cliente entrega efectivo (monto + comisión) y tú
     transfieres el monto desde una de tus cuentas. */
  const envCta      = c.envioPorCuenta || { mp: 0, cartera: 0, caja: 0 };
  const enviado     = num(c.enviado);
  const comEnvios   = num(c.comisionEnvios);
  const efectivoEnvios = redondear(enviado + comEnvios);

  /* --- Caja: el cliente paga las recargas y los envíos en efectivo */
  const esperadoCaja  = redondear(num(c.fondoApertura) + ingEfectivo + recargas
                                  + efectivoEnvios - num(envCta.caja)
                                  - num(egr.caja) - dotacion + tras.caja);
  const contadoCaja   = redondear(num(c.efectivoContado));
  const difCaja       = redondear(contadoCaja - esperadoCaja);

  /* --- Mercado Pago: la terminal descuenta su comisión antes de depositar,
         y las recargas salen del saldo MP devolviendo su comisión.          */
  const comTerminal   = comisionTerminal(c.tarjeta);
  const tarjetaNeto   = redondear(num(c.tarjeta) - comTerminal);
  const esperadoMp    = redondear(num(c.mpInicial) + num(c.transferencia) + tarjetaNeto
                                  - num(c.mpRetiros) - recargas + comisionRec
                                  - num(egr.mp) - num(envCta.mp) + tras.mp);
  const contadoMp     = redondear(num(c.mpCierre));
  const difMp         = redondear(contadoMp - esperadoMp);

  /* --- Cartera: entra lo que se le traspasa, sale lo que se paga desde ella */
  const esperadoCart  = redondear(num(c.carteraInicial) + dotacion
                                  - num(egr.cartera) - num(envCta.cartera) + tras.cartera);
  const contadoCart   = redondear(num(c.carteraCierre));
  const difCart       = redondear(contadoCart - esperadoCart);

  /* --- Tarjeta de crédito: es deuda, no saldo. Comprar la sube; pagarla la
         baja. tras.tc ya viene positivo cuando algo entró (=se pagó), así
         que aquí se resta en vez de sumarse como en las otras tres cuentas. */
  const tcInicial     = num(c.tcInicial);
  const comprasTC     = num(egr.tc);
  const esperadoTC    = redondear(tcInicial + comprasTC - tras.tc);
  const contadoTC     = redondear(num(c.tcCierre));
  const difTC         = redondear(contadoTC - esperadoTC);
  const mostrarTC     = CONFIG.tarjetaCreditoMonitoreo !== false;

  /* Renglones de traspaso, sólo los que mueven la cuenta que se está viendo */
  const renglonesTraspaso = (cuenta) => (c.traspasos || [])
    .filter(t => t.origen === cuenta || t.destino === cuenta)
    .map(t => {
      const entra = t.destino === cuenta;
      const otra  = CUENTAS[entra ? t.origen : t.destino];
      return [`${entra ? '+' : '−'} ${entra ? 'De' : 'A'} ${otra ? otra.label : '—'}` +
              (t.desc ? ` · ${t.desc}` : ''),
              (entra ? 1 : -1) * num(t.monto), entra ? 'mas' : 'menos'];
    });

  const bloques = [
    {
      clave: 'caja', label: 'Caja (efectivo)', icono: 'billete',
      esperado: esperadoCaja, contado: contadoCaja, dif: difCaja,
      ok: igualDinero(difCaja, 0),
      pistas: pistasCaja(difCaja, c),
      renglones: [
        ['Fondo de apertura',        num(c.fondoApertura), 'neutro'],
        ['+ Ventas en efectivo',     num(c.ventaEfectivo), 'mas'],
        ['+ Cobro de fiados',        num(c.pagoCreditos),  'mas'],
        ['+ Otros ingresos',         num(c.otrosIngresos), 'mas'],
        ['+ Recargas cobradas',      recargas,             'mas'],
        ...(efectivoEnvios ? [['+ Envíos cobrados en efectivo', efectivoEnvios, 'mas']] : []),
        ...(num(envCta.caja) ? [['− Enviado desde la caja', -num(envCta.caja), 'menos']] : []),
        ['− Pagos desde la caja',    -num(egr.caja),       'menos'],
        ...(dotacion ? [['− Dotación a cartera', -dotacion, 'menos']] : []),
        ...renglonesTraspaso('caja'),
      ],
    },
    {
      clave: 'mp', label: 'Mercado Pago', icono: 'telefono',
      esperado: esperadoMp, contado: contadoMp, dif: difMp,
      ok: igualDinero(difMp, 0),
      pistas: pistasMp(difMp, c, comTerminal),
      renglones: [
        ['Saldo inicial',                                       num(c.mpInicial),     'neutro'],
        ['+ Transferencias recibidas',                          num(c.transferencia), 'mas'],
        [`+ Tarjeta neta (−${fmtNum(CONFIG.comisionTerminalPct, 2)}% comisión)`, tarjetaNeto, 'mas'],
        ['+ Comisión devuelta por recargas',                    comisionRec,          'mas'],
        ['− Recargas procesadas',                               -recargas,            'menos'],
        ['− Pagos desde Mercado Pago',                          -num(egr.mp),         'menos'],
        ...(num(envCta.mp) ? [['− Enviado a clientes', -num(envCta.mp), 'menos']] : []),
        ...(num(c.mpRetiros) ? [['− Retiros y pagos desde MP', -num(c.mpRetiros), 'menos']] : []),
        ...renglonesTraspaso('mp'),
      ],
    },
    {
      clave: 'cartera', label: 'Cartera', icono: 'banco',
      esperado: esperadoCart, contado: contadoCart, dif: difCart,
      ok: igualDinero(difCart, 0),
      pistas: pistasCartera(difCart, c),
      renglones: [
        ['Saldo inicial',            num(c.carteraInicial), 'neutro'],
        ...(dotacion ? [['+ Dotación desde caja', dotacion, 'mas']] : []),
        ['− Pagos desde la cartera', -num(egr.cartera),     'menos'],
        ...(num(envCta.cartera) ? [['− Enviado a clientes', -num(envCta.cartera), 'menos']] : []),
        ...renglonesTraspaso('cartera'),
      ],
    },
    ...(mostrarTC ? [{
      clave: 'tc', label: CUENTAS.tc.largo, icono: 'tarjeta', esDeuda: true,
      esperado: esperadoTC, contado: contadoTC, dif: difTC,
      ok: igualDinero(difTC, 0),
      pistas: pistasTC(difTC, c),
      renglones: [
        ['Debías al abrir',            tcInicial, 'neutro'],
        ['+ Compras con la tarjeta',   comprasTC, 'mas'],
        // Un pago SUBE tras.tc pero BAJA la deuda: el renglón se arma a mano
        // para que el signo se vea correcto, en vez de reusar renglonesTraspaso().
        ...(c.traspasos || []).filter(t => t.destino === 'tc').map(t => {
          const de = CUENTAS[t.origen];
          return [`− Pagado desde ${de ? de.label : '—'}` + (t.desc ? ` · ${t.desc}` : ''),
                  -num(t.monto), 'menos'];
        }),
      ],
    }] : []),
  ];

  const totalFisico  = redondear(contadoCaja + contadoCart);
  const totalDigital = redondear(contadoMp);
  const ventaTotal   = redondear(num(c.ventaEfectivo) + num(c.tarjeta) + num(c.transferencia) + num(c.creditoClientes));

  return {
    bloques,
    todoOk: bloques.every(b => b.ok),
    esperadoCaja, contadoCaja, difCaja,
    esperadoMp, contadoMp, difMp,
    esperadoCart, contadoCart, difCart,
    esperadoTC, contadoTC, difTC,
    comisionTerminal: comTerminal, tarjetaNeto,
    totalFisico, totalDigital,
    totalValorizado: redondear(totalFisico + totalDigital),
    ventaTotal,
    ingEfectivo, egresos,
  };
}

function pistasCaja(dif, c) {
  if (igualDinero(dif, 0)) return [];
  const p = [];
  if (dif < 0) {
    p.push('Revisa que hayas registrado todos los egresos y la dotación a cartera.');
    if (num(c.totalRecargas) > 0) p.push('Confirma que las recargas se cobraron en efectivo.');
    p.push('Vuelve a contar el efectivo: es el error más común.');
  } else {
    p.push('Puede haber una venta cobrada en efectivo que no se registró.');
    if (num(c.pagoCreditos) === 0) p.push('¿Algún cliente abonó a su cuenta y no se capturó?');
  }
  return p;
}

function pistasMp(dif, c, comTerminal) {
  if (igualDinero(dif, 0)) return [];
  const p = [];
  if (num(c.tarjeta) > 0) {
    p.push(`La terminal descuenta ${fmt(comTerminal)} de comisión: el depósito llega neto, no por el monto cobrado.`);
  }
  if (dif < 0) {
    p.push('Verifica los retiros o pagos hechos desde Mercado Pago.');
    if (num(c.totalRecargas) > 0) p.push('Las recargas salen de tu saldo MP en el momento; la comisión regresa después.');
  } else {
    p.push('Puede haber una transferencia recibida que no se capturó.');
  }
  return p;
}

function pistasCartera(dif, c) {
  if (igualDinero(dif, 0)) return [];
  return dif > 0
    ? ['La cartera tiene de más: ¿entró dinero que no se registró como dotación?']
    : [`¿La dotación de ${fmt(c.dotacion)} realmente se depositó en la cartera?`];
}

function pistasTC(dif, c) {
  if (igualDinero(dif, 0)) return [];
  // Es deuda: "de más" significa que debes MÁS de lo que la app calculó.
  return dif > 0
    ? ['El estado de cuenta muestra más deuda de la esperada: ¿faltó capturar una compra con la tarjeta?']
    : ['El estado de cuenta muestra menos deuda de la esperada: revisa que los pagos a la tarjeta estén bien capturados.'];
}

/* --------------------------------------------------- foto del turno actual
   Objeto plano con todo lo necesario para cuadrar. Es también la base del
   corte que se guarda en el historial, para que reporte e historial siempre
   muestren exactamente los mismos números.                                */
function snapshotTurno() {
  const pos = totalesPos();
  const m   = TURNO.manual || {};

  const ventaEfectivo   = redondear(pos.efectivo       + num(m.ventaEfectivo));
  const tarjeta         = redondear(pos.tarjeta        + num(m.tarjeta));
  const transferencia   = redondear(pos.transferencia  + num(m.transferencia) + pos.abonosTransfer);
  const pagoCreditos    = redondear(pos.abonosEfectivo + num(m.pagoCreditos));
  const creditoClientes = redondear(pos.credito        + num(m.creditoClientes));
  const otrosIngresos   = sumaLista(TURNO.otrosIngresos);
  const totalRecargas   = redondear(pos.recargas       + num(m.recargas));

  return {
    /* identificación */
    id: TURNO.id,
    cajero: TURNO.cajero, fecha: TURNO.fecha, horario: TURNO.horario, notas: TURNO.notas,
    inicio: TURNO.inicio,

    /* efectivo */
    aperturaModo: TURNO.aperturaModo, piezasApertura: { ...TURNO.piezasApertura },
    cierreModo: TURNO.cierreModo,     piezasCierre:   { ...TURNO.piezasCierre },
    fondoApertura: fondoDeApertura(),
    efectivoContado: efectivoContado(),

    /* ingresos ya sumados (POS + captura manual) */
    ventaEfectivo, tarjeta, transferencia, pagoCreditos, creditoClientes, otrosIngresos,
    otrosIngresosList: structuredClone(TURNO.otrosIngresos),
    // En edición se conservan las estadísticas del POS del corte original
    pos: TURNO.modoEdicion && TURNO.posOriginal ? TURNO.posOriginal : pos,

    /* recargas */
    totalRecargas,
    comisionRecargas: comisionPorRecargas(totalRecargas),

    /* envíos de dinero: lo transferido sale de tu cuenta y el efectivo
       —monto más comisión— entra a la caja */
    enviado:        num(pos.enviado),
    comisionEnvios: num(pos.comisionEnvios),
    envioPorCuenta: pos.envioPorCuenta || { mp: 0, cartera: 0, caja: 0 },

    /* egresos */
    compras:     structuredClone(TURNO.compras),
    proveedores: structuredClone(TURNO.proveedores),
    servicios:   structuredClone(TURNO.servicios),
    honorarios:  structuredClone(TURNO.honorarios),
    gastos:      structuredClone(TURNO.gastos),
    otrosEgresos: structuredClone(TURNO.otrosEgresos),
    egresos: totalEgresos(),
    egresosPorCuenta: egresosPorCuenta(),

    /* movimientos entre las tres cuentas */
    traspasos: structuredClone(TURNO.traspasos || []),

    /* cartera y mercado pago */
    dotacion: num(TURNO.dotacion),
    carteraInicial: num(TURNO.carteraInicial),
    carteraCierre: num(TURNO.carteraCierre),
    mpInicial: num(TURNO.mpInicial),
    mpRetiros: num(TURNO.mpRetiros),
    mpCierre: num(TURNO.mpCierre),

    /* tarjeta de crédito (deuda, ligada a Mercado Pago) */
    tcInicial: num(TURNO.tcInicial),
    tcCierre: num(TURNO.tcCierre),

    obs: TURNO.obs,
  };
}

/* ------------------------------------------------------------ abrir turno */
async function abrirTurno() {
  // Vienen de TURNO porque el desplegable puede estar en "Otro…", y entonces
  // el nombre real está en el campo de texto de al lado.
  const cajero  = String(TURNO.cajero  || '').trim();
  const horario = String(TURNO.horario || '').trim();

  if (!cajero)  { toast('Elige o escribe quién es el responsable del turno.', 'error'); return; }
  if (!horario) { toast('Elige o escribe el horario del turno.', 'error'); return; }

  const yaAbierto = TURNO.abierto;   // esta pantalla también sirve para corregir
  const fondo = fondoDeApertura();
  if (fondo <= 0 && !yaAbierto) {
    const ok = await confirmar({
      titulo: 'Fondo en cero',
      mensaje: 'Vas a abrir el turno sin fondo de caja. ¿Es correcto?',
      ok: 'Sí, abrir así',
    });
    if (!ok) return;
  }

  TURNO.id       = TURNO.id || nuevoId('trn');
  TURNO.abierto  = true;
  TURNO.cajero   = cajero;
  TURNO.horario  = horario;
  TURNO.fecha    = document.getElementById('ap-fecha')?.value || hoyISO();
  TURNO.notas    = document.getElementById('ap-notas')?.value || '';
  TURNO.inicio   = TURNO.inicio || new Date().toISOString();
  TURNO.fondoApertura  = fondo;
  // Los campos ya sincronizan al escribir; si están vacíos se conserva el valor
  const leerSaldo = (id, actual) => {
    const el = document.getElementById(id);
    return el && String(el.value).trim() !== '' ? Math.max(0, num(el.value)) : num(actual);
  };
  TURNO.mpInicial      = leerSaldo('ap-mp-inicial', TURNO.mpInicial);
  TURNO.carteraInicial = leerSaldo('ap-cartera-inicial', TURNO.carteraInicial);
  TURNO.tcInicial = leerSaldo('ap-tc-inicial', TURNO.tcInicial);
  // Al abrir, los saldos de cierre parten de los iniciales: evita cuadres
  // "en rojo" sólo porque el campo estaba vacío.
  if (!TURNO.mpCierre)      TURNO.mpCierre      = TURNO.mpInicial;
  if (!TURNO.carteraCierre) TURNO.carteraCierre = TURNO.carteraInicial;
  if (!TURNO.tcCierre)      TURNO.tcCierre      = TURNO.tcInicial;

  if (!yaAbierto) CORTE_MOSTRADO = null;   // el reporte vuelve a la vista en vivo

  guardarTurno({ inmediato: true });
  actualizarEstadoGlobal();
  irA('pos');
  toast(yaAbierto
    ? `Fondo corregido: ${fmt(fondo)}. El cuadre se recalculó.`
    : `Turno abierto · ${cajero} · fondo ${fmt(fondo)}`, 'success');
  respaldarPronto('apertura');
}

/* ------------------------------------------------------------ cerrar turno */
async function cerrarTurno() {
  if (!TURNO.abierto) { toast('No hay ningún turno abierto.', 'error'); return; }

  const snap   = snapshotTurno();
  const cuadre = calcularCuadre(snap);

  let detalle = cuadre.todoOk
    ? '<p>Todo cuadra. Se guardará el corte y quedará listo el siguiente turno.</p>'
    : `<p>Hay diferencias sin resolver:</p><ul class="lista-dif">` +
      cuadre.bloques.filter(b => !b.ok)
        .map(b => `<li><strong>${b.label}:</strong> ${fmtDiff(b.dif)}</li>`).join('') +
      `</ul><p class="hint">Puedes cerrar de todos modos; la diferencia quedará registrada en el corte.</p>`;

  // Los tickets apartados se van con el turno: hay que decirlo antes, no después
  const conCosas = (TURNO.tickets || []).filter(t => (t.carrito || []).length);
  const apartados = conCosas.length;
  if (apartados) {
    detalle += `<p><strong>Ojo:</strong> quedan ${apartados} ticket(s) apartados sin cobrar
      (${conCosas.map(t => esc(etiquetaTicket(t.carrito))).join(', ')}).
      Se perderán al cerrar el turno.</p>`;
  }

  const ok = await confirmar({
    titulo: TURNO.editandoCorteId ? 'Guardar cambios del corte' : 'Cerrar turno y hacer corte',
    mensaje: detalle,
    ok: TURNO.editandoCorteId ? 'Guardar cambios' : 'Cerrar turno',
    peligro: !cuadre.todoOk,
  });
  if (!ok) return;

  const editando = TURNO.editandoCorteId;
  const corte = {
    ...snap,
    id: editando || nuevoId('crt'),
    turnoId: TURNO.id,
    fechaHora: new Date().toISOString(),
    cierre: new Date().toISOString(),

    /* resultados del cuadre, congelados tal como se vieron en pantalla */
    esperadoCaja: cuadre.esperadoCaja, difCaja: cuadre.difCaja,
    esperadoMp:   cuadre.esperadoMp,   difMp:   cuadre.difMp,
    esperadoCartera: cuadre.esperadoCart, difCartera: cuadre.difCart,
    esperadoTC: cuadre.esperadoTC, difTC: cuadre.difTC,
    comisionTerminalMonto: cuadre.comisionTerminal,
    tarjetaNeto: cuadre.tarjetaNeto,
    totalFisico: cuadre.totalFisico,
    totalDigital: cuadre.totalDigital,
    totalValorizado: cuadre.totalValorizado,
    ventaTotal: cuadre.ventaTotal,
    cuadrado: cuadre.todoOk,

    /* ventas del POS asociadas, para poder auditar el corte después */
    ventasIds: ventasDelTurno().map(v => v.id),
  };

  const cortes = Store.get(DB.cortes, []);
  if (editando) {
    const i = cortes.findIndex(c => String(c.id) === String(editando));
    if (i >= 0) {
      corte.fechaHora = cortes[i].fechaHora;      // conserva la fecha original
      corte.editadoEn = new Date().toISOString();
      cortes[i] = corte;
    } else {
      cortes.unshift(corte);
    }
  } else {
    cortes.unshift(corte);
  }
  Store.set(DB.cortes, cortes);

  // Marca las ventas como ya cortadas para que no entren en otro turno
  const ventas = getVentas();
  ventas.forEach(v => { if (v.turnoId === TURNO.id) v.corteId = corte.id; });
  setVentas(ventas);

  await Respaldo.escribir('corte');
  if (CONFIG.respaldoAuto !== false && !(await Respaldo.carpeta())) {
    // Sin carpeta configurada, se descarga una copia como red de seguridad
    await descargarArchivo(`respaldo_tanichi_${hoyISO()}.json`, JSON.stringify(construirRespaldo(), null, 2));
  }

  TURNO = turnoVacio();
  // Para no volver a capturar lo mismo: el turno que sigue abre con lo que
  // este dejó al cerrar (efectivo, MP, cartera y tarjeta de crédito).
  TURNO.aperturaModo   = corte.cierreModo || 'rapido';
  TURNO.piezasApertura = structuredClone(corte.piezasCierre || {});
  TURNO.fondoRapido    = num(corte.efectivoContado);
  TURNO.mpInicial      = num(corte.mpCierre);
  TURNO.carteraInicial = num(corte.carteraCierre);
  TURNO.tcInicial       = num(corte.tcCierre);
  guardarTurno({ inmediato: true });
  Store.remove(DB.turno);

  const ui = Store.get(DB.ui, {});
  ui.ultimoCorteId = corte.id;
  Store.set(DB.ui, ui);

  mostrarReporteCorte(corte);        // debe ir antes: habilita la vista de corte
  actualizarEstadoGlobal();
  irA('corte');
  toast(editando ? 'Cambios guardados en el corte.' : 'Corte realizado. Turno cerrado.', 'success', 5000);
}

/* -------------------------------------------------- reabrir / descartar */
async function descartarTurno() {
  const ventas = ventasDelTurno().length;
  const ok = await confirmar({
    titulo: 'Descartar el turno abierto',
    mensaje: `Se borrará el conteo y la captura de este turno sin guardar el corte.` +
             (ventas ? `<br><strong>Las ${ventas} ventas registradas se conservan</strong> y podrás asignarlas a un turno nuevo.` : '') +
             `<br><br>Esta acción no se puede deshacer.`,
    ok: 'Descartar turno', peligro: true,
  });
  if (!ok) return;
  TURNO = turnoVacio();
  Store.remove(DB.turno);
  CORTE_MOSTRADO = null;
  actualizarEstadoGlobal();
  irA('apertura');
  toast('Turno descartado.', 'info');
}

/** Reabre un corte guardado para corregirlo. */
async function editarCorte(id) {
  if (TURNO.abierto) {
    toast('Cierra o descarta el turno abierto antes de editar un corte guardado.', 'warn', 6000);
    return;
  }
  const corte = Store.get(DB.cortes, []).find(c => String(c.id) === String(id));
  if (!corte) { toast('No se encontró ese corte.', 'error'); return; }

  const ok = await confirmar({
    titulo: 'Editar corte guardado',
    mensaje: `Se abrirá el corte del <strong>${fechaCorta(corte.fecha)}</strong> (${esc(corte.horario || corte.turno || '')})
              como si fuera el turno en curso. Al guardar, reemplazará al original.`,
    ok: 'Editar corte',
  });
  if (!ok) return;

  TURNO = {
    ...turnoVacio(),
    id: corte.turnoId || nuevoId('trn'),
    abierto: true,
    cajero: corte.cajero, fecha: corte.fecha,
    horario: corte.horario || corte.turno || '',
    notas: corte.notas || '',
    inicio: corte.inicio || corte.fechaHora,
    aperturaModo: corte.aperturaModo || 'rapido',
    piezasApertura: corte.piezasApertura || {},
    fondoRapido: num(corte.fondoApertura),
    fondoApertura: num(corte.fondoApertura),
    cierreModo: corte.cierreModo || 'rapido',
    piezasCierre: corte.piezasCierre || {},
    cierreRapido: num(corte.efectivoContado ?? corte.totalCaja),
    mpInicial: num(corte.mpInicial), carteraInicial: num(corte.carteraInicial ?? corte.bancoInicial),
    mpRetiros: num(corte.mpRetiros), mpCierre: num(corte.mpCierre),
    carteraCierre: num(corte.carteraCierre ?? corte.bancoCorte ?? corte.totalCartera),
    dotacion: num(corte.dotacion),
    tcInicial: num(corte.tcInicial), tcCierre: num(corte.tcCierre),
    traspasos: structuredClone(corte.traspasos || []),
    // Al reabrir, lo capturado en el POS ya está congelado en el corte:
    // se traslada a la captura manual para no perder ni duplicar importes.
    manual: {
      ventaEfectivo:   num(corte.ventaEfectivo),
      transferencia:   num(corte.transferencia),
      tarjeta:         num(corte.tarjeta),
      pagoCreditos:    num(corte.pagoCreditos),
      creditoClientes: num(corte.creditoClientes),
      recargas:        num(corte.totalRecargas),
    },
    modoEdicion: true,
    posOriginal: corte.pos || null,
    otrosIngresos: structuredClone(corte.otrosIngresosList || corte.otrosList || []),
    compras:       structuredClone(corte.compras || []),
    proveedores:   structuredClone(corte.proveedores   || corte.proveedoresList   || []),
    servicios:     structuredClone(corte.servicios     || corte.serviciosList     || []),
    honorarios:    structuredClone(corte.honorarios    || corte.honorariosList    || []),
    gastos:        structuredClone(corte.gastos || []),
    otrosEgresos:  structuredClone(corte.otrosEgresos  || corte.otrosRetirosList  || []),
    obs: corte.obs || '',
    editandoCorteId: corte.id,
  };
  guardarTurno({ inmediato: true });
  CORTE_MOSTRADO = null;
  cerrarModalesAbiertos();
  actualizarEstadoGlobal();
  irA('corte');
  activarTabCorte('efectivo');
  renderCorte();
  toast('Editando un corte guardado. Al cerrar el turno se reemplazará el original.', 'info', 6000);
}

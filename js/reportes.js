/* ============================================================================
   TANICHI · REPORTES
   Reportes sobre el mismo periodo. Todos devuelven la misma forma
   —columnas, filas y totales— para que imprimir y exportar a CSV funcionen
   igual en todos, sin código repetido.
   ========================================================================== */

const REPORTES = {
  ventas:     { nombre: 'Ventas y ganancias',           ico: 'grafica' },
  cortes:     { nombre: 'Cortes de caja',               ico: 'balanza' },
  masVendido: { nombre: 'Más vendidos',                 ico: 'estrella'},
  devoluciones: { nombre: 'Devoluciones',               ico: 'regresar' },
  recargas:   { nombre: 'Recargas y abonos',           ico: 'telefono'},
};

/* El reporte de ventas se mira a tres alturas. Es el mismo reporte: cambia
   el detalle, no los números. */
const NIVELES = {
  dia:      'Por día',
  ticket:   'Ticket por ticket',
  producto: 'Renglón por renglón',
};

const REP = { tipo: 'ventas', nivel: 'dia', desde: '', hasta: '', datos: null };

/* ---------------------------------------------------------- utilidades */

/** Movimientos válidos dentro del periodo elegido. */
function movimientosDelPeriodo() {
  return getVentas().filter(v => {
    if (v.cancelada) return false;
    if (REP.desde && String(v.fecha) < REP.desde) return false;
    if (REP.hasta && String(v.fecha) > REP.hasta) return false;
    return true;
  });
}

function cortesDelPeriodo() {
  return Store.get(DB.cortes, []).filter(c => {
    if (REP.desde && String(c.fecha) < REP.desde) return false;
    if (REP.hasta && String(c.fecha) > REP.hasta) return false;
    return true;
  });
}

function etiquetaPeriodo() {
  if (REP.desde && REP.hasta) return `Del ${fechaCorta(REP.desde)} al ${fechaCorta(REP.hasta)}`;
  if (REP.desde) return `Desde ${fechaCorta(REP.desde)}`;
  if (REP.hasta) return `Hasta ${fechaCorta(REP.hasta)}`;
  return 'Todo el historial';
}

/** Atajos de periodo que se usan a diario. */
function periodoRapido(cual) {
  const hoy = new Date();
  const iso = (d) => hoyISO(d);
  const menos = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

  if (cual === 'hoy')     { REP.desde = iso(hoy); REP.hasta = iso(hoy); }
  if (cual === 'ayer')    { const a = menos(1); REP.desde = iso(a); REP.hasta = iso(a); }
  if (cual === 'semana')  { REP.desde = iso(menos(6)); REP.hasta = iso(hoy); }
  if (cual === 'mes')     { REP.desde = iso(menos(29)); REP.hasta = iso(hoy); }
  if (cual === 'todo')    { REP.desde = ''; REP.hasta = ''; }

  setVal('rep-desde', REP.desde);
  setVal('rep-hasta', REP.hasta);
  renderReporte();
}

/* ====================================================== los cinco reportes
   Cada uno devuelve { columnas, filas, totales, resumen }.
   `columnas`: [{ titulo, clave, tipo }] — tipo 'dinero' | 'numero' | 'texto'
   ====================================================================== */

/* ================================================= VENTAS Y GANANCIAS ====
   Un solo reporte, tres alturas. La ganancia sale del costo congelado en
   cada venta; para las ventas viejas —capturadas antes de que se guardara—
   se recurre al costo actual del producto y se avisa en el encabezado. */

let _sinCosto = 0;   // renglones cuyo costo hubo que estimar

/** Costo de un renglón vendido: el que se guardó, o el del catálogo. */
function costoDeRenglon(item) {
  if (item.costo !== undefined && item.costo !== null) return num(item.costo);
  const p = item.productoId ? buscarProducto(item.productoId) : null;
  if (p && num(p.costo) > 0) { _sinCosto++; return num(p.costo); }
  if (item.productoId) _sinCosto++;
  return 0;                       // venta libre o producto sin costo capturado
}

/** Recorre los movimientos del periodo entregando renglón por renglón. */
function renglonesDeVenta() {
  _sinCosto = 0;
  const filas = [];
  movimientosDelPeriodo()
    .filter(v => v.tipo === 'venta' || v.tipo === 'devolucion' || v.tipo === 'envio')
    .sort((a, b) => String(b.fechaHora).localeCompare(String(a.fechaHora)))
    .forEach(v => {
      /* En un envío de dinero lo vendido es el servicio, no el monto: el
         dinero transferido sólo cambió de cuenta. Entra sólo la comisión. */
      if (v.tipo === 'envio') {
        const com = num(v.comision);
        filas.push({
          _venta: v, _fecha: v.fecha,
          folio: '#' + v.folio, fecha: fechaCorta(v.fecha), hora: horaDe(v.fechaHora),
          tipo: 'Envío', producto: `Comisión por envío de ${fmt(v.montoEnviado)}`, codigo: '',
          cantidad: 1, precio: com, venta: com, costo: 0, ganancia: com,
          cajero: v.cajero || '', cliente: v.cliente || '',
        });
        return;
      }
      const signo = v.tipo === 'devolucion' ? -1 : 1;
      (v.items || []).forEach(i => {
        const cant   = signo * num(i.cantidad);
        const venta  = signo * num(i.importe);
        const costo  = redondear(costoDeRenglon(i) * cant);
        filas.push({
          _venta: v, _fecha: v.fecha,
          folio: '#' + v.folio, fecha: fechaCorta(v.fecha), hora: horaDe(v.fechaHora),
          tipo: v.tipo === 'devolucion' ? 'Devolución' : 'Venta',
          producto: i.nombre, codigo: i.sku || '',
          cantidad: cant, precio: num(i.precio),
          venta, costo, ganancia: redondear(venta - costo),
          cajero: v.cajero || '', cliente: v.cliente || '',
        });
      });
    });
  return filas;
}

const COL_DINERO = (titulo, clave) => ({ titulo, clave, tipo: 'dinero' });

/** Margen en texto, evitando dividir entre cero. */
function margenPct(ganancia, venta) {
  return num(venta) > 0 ? `${fmtNum((num(ganancia) / num(venta)) * 100, 1)}%` : '—';
}

function repVentas() {
  const renglones = renglonesDeVenta();
  const movs = movimientosDelPeriodo();

  // Los egresos guardados en los cortes del periodo: la ganancia real los resta
  const egresos = redondear(cortesDelPeriodo().reduce((s, c) => s + num(c.egresos), 0));

  let filas, columnas, totales;
  const sumaR = (k) => redondear(renglones.reduce((s, f) => s + num(f[k]), 0));
  const ventaTotal    = sumaR('venta');
  const costoTotal    = sumaR('costo');
  const gananciaTotal = redondear(ventaTotal - costoTotal);
  const tickets = movs.filter(v => v.tipo === 'venta').length;

  if (REP.nivel === 'producto') {
    filas = renglones;
    columnas = [
      { titulo: 'Folio', clave: 'folio', tipo: 'texto' },
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Hora', clave: 'hora', tipo: 'texto' },
      { titulo: 'Tipo', clave: 'tipo', tipo: 'texto' },
      { titulo: 'Producto', clave: 'producto', tipo: 'texto' },
      { titulo: 'Código', clave: 'codigo', tipo: 'texto' },
      { titulo: 'Cantidad', clave: 'cantidad', tipo: 'numero' },
      COL_DINERO('Precio', 'precio'), COL_DINERO('Venta', 'venta'),
      COL_DINERO('Costo', 'costo'), COL_DINERO('Ganancia', 'ganancia'),
      { titulo: 'Cajero', clave: 'cajero', tipo: 'texto' },
    ];
    totales = { folio: 'TOTAL', cantidad: sumaR('cantidad'), venta: ventaTotal,
                costo: costoTotal, ganancia: gananciaTotal };

  } else if (REP.nivel === 'ticket') {
    const porTicket = new Map();
    renglones.forEach(f => {
      const v = f._venta;
      const t = porTicket.get(v.id) || {
        folio: '#' + v.folio, fecha: fechaCorta(v.fecha), hora: horaDe(v.fechaHora),
        tipo: f.tipo, cliente: v.cliente || '', cajero: v.cajero || '',
        piezas: 0, venta: 0, costo: 0, ganancia: 0,
        pago: (v.pagos || []).map(p => METODOS_PAGO[p.metodo]?.label || p.metodo).join(' + '),
        _orden: v.fechaHora,
      };
      t.piezas += f.cantidad; t.venta += f.venta; t.costo += f.costo; t.ganancia += f.ganancia;
      porTicket.set(v.id, t);
    });
    filas = [...porTicket.values()]
      .map(t => ({ ...t, venta: redondear(t.venta), costo: redondear(t.costo), ganancia: redondear(t.ganancia) }))
      .sort((a, b) => String(b._orden).localeCompare(String(a._orden)));
    columnas = [
      { titulo: 'Folio', clave: 'folio', tipo: 'texto' },
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Hora', clave: 'hora', tipo: 'texto' },
      { titulo: 'Tipo', clave: 'tipo', tipo: 'texto' },
      { titulo: 'Piezas', clave: 'piezas', tipo: 'numero' },
      { titulo: 'Cómo pagó', clave: 'pago', tipo: 'texto' },
      { titulo: 'Cliente', clave: 'cliente', tipo: 'texto' },
      COL_DINERO('Venta', 'venta'), COL_DINERO('Costo', 'costo'), COL_DINERO('Ganancia', 'ganancia'),
      { titulo: 'Cajero', clave: 'cajero', tipo: 'texto' },
    ];
    totales = { folio: 'TOTAL', piezas: redondear(filas.reduce((s, f) => s + num(f.piezas), 0)),
                venta: ventaTotal, costo: costoTotal, ganancia: gananciaTotal };

  } else {
    /* --- por día: la vista de siempre, ahora con costo y ganancia --- */
    const porDia = new Map();
    const dia = (f) => {
      if (!porDia.has(f)) porDia.set(f, {
        _fecha: f, fecha: fechaCorta(f), tickets: 0, piezas: 0,
        efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0,
        devuelto: 0, venta: 0, costo: 0, ganancia: 0,
      });
      return porDia.get(f);
    };
    movs.forEach(v => {
      const d = dia(v.fecha);
      const signo = v.tipo === 'devolucion' ? -1 : 1;
      if (v.tipo === 'venta') d.tickets++;
      if (v.tipo === 'devolucion') d.devuelto += num(v.total);
      (v.pagos || []).forEach(p => {
        if (d[p.metodo] !== undefined) d[p.metodo] += signo * num(p.monto);
      });
    });
    renglones.forEach(f => {
      const d = dia(f._fecha);
      d.piezas += f.cantidad; d.venta += f.venta; d.costo += f.costo; d.ganancia += f.ganancia;
    });

    filas = [...porDia.values()]
      .map(d => ({ ...d, venta: redondear(d.venta), costo: redondear(d.costo),
                   ganancia: redondear(d.ganancia), margen: margenPct(d.ganancia, d.venta) }))
      .sort((a, b) => String(b._fecha).localeCompare(String(a._fecha)));

    columnas = [
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Tickets', clave: 'tickets', tipo: 'numero' },
      { titulo: 'Piezas', clave: 'piezas', tipo: 'numero' },
      COL_DINERO('Efectivo', 'efectivo'), COL_DINERO('Tarjeta', 'tarjeta'),
      COL_DINERO('Transfer.', 'transferencia'), COL_DINERO('Fiado', 'credito'),
      COL_DINERO('Devuelto', 'devuelto'), COL_DINERO('Venta', 'venta'),
      COL_DINERO('Costo', 'costo'), COL_DINERO('Ganancia', 'ganancia'),
      { titulo: 'Margen', clave: 'margen', tipo: 'texto' },
    ];
    const s = (k) => redondear(filas.reduce((a, f) => a + num(f[k]), 0));
    totales = {
      fecha: 'TOTAL', tickets, piezas: s('piezas'),
      efectivo: s('efectivo'), tarjeta: s('tarjeta'), transferencia: s('transferencia'),
      credito: s('credito'), devuelto: s('devuelto'),
      venta: ventaTotal, costo: costoTotal, ganancia: gananciaTotal,
      margen: margenPct(gananciaTotal, ventaTotal),
    };
  }

  const resumen = [
    ['Venta del periodo', fmt(ventaTotal)],
    ['Costo de lo vendido', fmt(costoTotal)],
    ['Ganancia bruta', fmt(gananciaTotal)],
    ['Margen', margenPct(gananciaTotal, ventaTotal)],
    ['Gastos del periodo', fmt(egresos)],
    ['GANANCIA NETA', fmt(redondear(gananciaTotal - egresos))],
    ['Tickets', fmtNum(tickets)],
    ['Ticket promedio', fmt(tickets ? ventaTotal / tickets : 0)],
  ];

  return {
    columnas, filas, totales, resumen,
    nota: _sinCosto
      ? `${fmtNum(_sinCosto)} renglón(es) sin costo guardado: se estimó con el costo actual del catálogo`
      : '',
  };
}

function repCortes() {
  const filas = cortesDelPeriodo()
    .sort((a, b) => String(b.fechaHora).localeCompare(String(a.fechaHora)))
    .map(c => {
      const cu = calcularCuadre(c);
      return {
        fecha: fechaCorta(c.fecha),
        turno: c.horario || c.turno || '',
        cajero: c.cajero || '',
        fondo: num(c.fondoApertura),
        venta: cu.ventaTotal,
        egresos: num(c.egresos),
        esperado: cu.esperadoCaja,
        contado: cu.contadoCaja,
        diferencia: cu.difCaja,
        estado: cu.todoOk ? 'Cuadró' : 'Con diferencia',
      };
    });

  const suma = (k) => redondear(filas.reduce((s, f) => s + num(f[k]), 0));
  return {
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Turno', clave: 'turno', tipo: 'texto' },
      { titulo: 'Responsable', clave: 'cajero', tipo: 'texto' },
      { titulo: 'Fondo', clave: 'fondo', tipo: 'dinero' },
      { titulo: 'Venta', clave: 'venta', tipo: 'dinero' },
      { titulo: 'Egresos', clave: 'egresos', tipo: 'dinero' },
      { titulo: 'Esperado', clave: 'esperado', tipo: 'dinero' },
      { titulo: 'Contado', clave: 'contado', tipo: 'dinero' },
      { titulo: 'Diferencia', clave: 'diferencia', tipo: 'dinero' },
      { titulo: 'Estado', clave: 'estado', tipo: 'texto' },
    ],
    filas,
    totales: { fecha: 'TOTAL', venta: suma('venta'), egresos: suma('egresos'), diferencia: suma('diferencia') },
    resumen: [
      ['Cortes', fmtNum(filas.length)],
      ['Venta acumulada', fmt(suma('venta'))],
      ['Egresos', fmt(suma('egresos'))],
      ['Diferencia acumulada', fmtDiff(suma('diferencia'))],
      ['Cortes con diferencia', fmtNum(filas.filter(f => f.estado !== 'Cuadró').length)],
    ],
  };
}

function repMasVendidos() {
  const acum = new Map();
  movimientosDelPeriodo()
    .filter(v => v.tipo === 'venta' || v.tipo === 'devolucion')
    .forEach(v => {
      const signo = v.tipo === 'devolucion' ? -1 : 1;
      (v.items || []).forEach(i => {
        const clave = i.productoId || ('libre:' + i.nombre);
        const a = acum.get(clave) || { producto: i.nombre, codigo: i.sku || '', piezas: 0, importe: 0, tickets: 0 };
        a.piezas  += signo * num(i.cantidad);
        a.importe += signo * num(i.importe);
        if (signo > 0) a.tickets++;
        acum.set(clave, a);
      });
    });

  const productos = new Map(getProductos().map(p => [p.id, p]));
  const filas = [...acum.entries()]
    .map(([clave, a]) => {
      const p = productos.get(clave);
      const costo = p ? num(p.costo) * a.piezas : 0;
      return { ...a, categoria: p ? (p.categoria || 'General') : 'Sin catálogo',
               ganancia: p && num(p.costo) > 0 ? redondear(a.importe - costo) : '' };
    })
    .filter(f => f.piezas !== 0)
    .sort((a, b) => b.piezas - a.piezas);

  const suma = (k) => redondear(filas.reduce((s, f) => s + num(f[k]), 0));
  return {
    columnas: [
      { titulo: 'Producto', clave: 'producto', tipo: 'texto' },
      { titulo: 'Código', clave: 'codigo', tipo: 'texto' },
      { titulo: 'Categoría', clave: 'categoria', tipo: 'texto' },
      { titulo: 'Piezas', clave: 'piezas', tipo: 'numero' },
      { titulo: 'Tickets', clave: 'tickets', tipo: 'numero' },
      { titulo: 'Importe', clave: 'importe', tipo: 'dinero' },
      { titulo: 'Ganancia', clave: 'ganancia', tipo: 'dinero' },
    ],
    filas,
    totales: { producto: 'TOTAL', piezas: suma('piezas'), importe: suma('importe'), ganancia: suma('ganancia') },
    resumen: [
      ['Productos distintos', fmtNum(filas.length)],
      ['Piezas vendidas', fmtNum(suma('piezas'), suma('piezas') % 1 ? 2 : 0)],
      ['Importe', fmt(suma('importe'))],
      ['El más vendido', filas[0] ? `${filas[0].producto} (${fmtNum(filas[0].piezas)})` : '—'],
    ],
  };
}

function repDevoluciones() {
  const devols = movimientosDelPeriodo()
    .filter(v => v.tipo === 'devolucion')
    .sort((a, b) => String(b.fechaHora).localeCompare(String(a.fechaHora)));

  const ventas = new Map(getVentas().map(v => [v.id, v]));
  const filas = [];
  devols.forEach(d => {
    const orig = ventas.get(d.ventaOriginal);
    (d.items || []).forEach(i => filas.push({
      folio: '#' + d.folio,
      fecha: fechaCorta(d.fecha),
      hora: horaDe(d.fechaHora),
      ventaOriginal: d.folioOriginal ? '#' + d.folioOriginal : '',
      diaVenta: orig ? fechaCorta(orig.fecha) : '',
      producto: i.nombre,
      codigo: i.sku || '',
      piezas: num(i.cantidad),
      precio: num(i.precio),
      importe: num(i.importe),
      devueltoPor: (d.pagos || []).map(p => METODOS_PAGO[p.metodo]?.label || p.metodo).join(' + '),
      cajero: d.cajero || '',
    }));
  });

  const suma = (k) => redondear(filas.reduce((s, f) => s + num(f[k]), 0));
  const porMetodo = {};
  devols.forEach(d => (d.pagos || []).forEach(p => {
    porMetodo[p.metodo] = redondear(num(porMetodo[p.metodo]) + num(p.monto));
  }));

  /* Qué tanto de lo vendido se regresó: si sube, algo pasa con ese producto */
  const vendido = redondear(movimientosDelPeriodo()
    .filter(v => v.tipo === 'venta').reduce((s, v) => s + num(v.total), 0));
  const tasa = vendido > 0 ? (suma('importe') / vendido) * 100 : 0;

  const masDevuelto = [...filas.reduce((m, f) => {
    m.set(f.producto, num(m.get(f.producto)) + f.piezas); return m;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    columnas: [
      { titulo: 'Folio', clave: 'folio', tipo: 'texto' },
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Hora', clave: 'hora', tipo: 'texto' },
      { titulo: 'Venta original', clave: 'ventaOriginal', tipo: 'texto' },
      { titulo: 'Día de la venta', clave: 'diaVenta', tipo: 'texto' },
      { titulo: 'Producto', clave: 'producto', tipo: 'texto' },
      { titulo: 'Código', clave: 'codigo', tipo: 'texto' },
      { titulo: 'Piezas', clave: 'piezas', tipo: 'numero' },
      { titulo: 'Precio', clave: 'precio', tipo: 'dinero' },
      { titulo: 'Importe', clave: 'importe', tipo: 'dinero' },
      { titulo: 'Devuelto por', clave: 'devueltoPor', tipo: 'texto' },
      { titulo: 'Cajero', clave: 'cajero', tipo: 'texto' },
    ],
    filas,
    totales: { folio: 'TOTAL', piezas: suma('piezas'), importe: suma('importe') },
    resumen: [
      ['Devoluciones', fmtNum(devols.length)],
      ['Piezas regresadas', fmtNum(suma('piezas'), suma('piezas') % 1 ? 2 : 0)],
      ['Importe devuelto', fmt(suma('importe'))],
      ['Sobre lo vendido', vendido > 0 ? fmtNum(tasa, 1) + '%' : '—'],
      ['Más devuelto', masDevuelto ? `${masDevuelto[0]} (${fmtNum(masDevuelto[1])})` : '—'],
      ['En efectivo', fmt(porMetodo.efectivo)],
    ],
  };
}

function repRecargasYAbonos() {
  // Las devoluciones tienen su propio reporte: aquí sólo servicios y abonos
  const movs = movimientosDelPeriodo()
    .filter(v => v.tipo === 'recarga' || v.tipo === 'abono')
    .sort((a, b) => String(b.fechaHora).localeCompare(String(a.fechaHora)));

  const filas = movs.map(v => ({
    folio: '#' + v.folio,
    fecha: fechaCorta(v.fecha),
    hora: horaDe(v.fechaHora),
    tipo: v.tipo === 'recarga' ? 'Recarga' : 'Abono a cuenta',
    detalle: (v.items || []).map(i => i.nombre).join(', ') +
             (v.folioOriginal ? ` (de la venta #${v.folioOriginal})` : ''),
    metodo: (v.pagos || []).map(p => METODOS_PAGO[p.metodo]?.label || p.metodo).join(' + '),
    importe: num(v.total),
    cajero: v.cajero || '',
  }));

  const totalRecargas = redondear(movs.filter(v => v.tipo === 'recarga').reduce((s, v) => s + num(v.total), 0));
  const comision = comisionPorRecargas(totalRecargas);
  const totalAbonos = redondear(movs.filter(v => v.tipo === 'abono').reduce((s, v) => s + num(v.total), 0));

  return {
    columnas: [
      { titulo: 'Folio', clave: 'folio', tipo: 'texto' },
      { titulo: 'Fecha', clave: 'fecha', tipo: 'texto' },
      { titulo: 'Hora', clave: 'hora', tipo: 'texto' },
      { titulo: 'Tipo', clave: 'tipo', tipo: 'texto' },
      { titulo: 'Detalle', clave: 'detalle', tipo: 'texto' },
      { titulo: 'Forma', clave: 'metodo', tipo: 'texto' },
      { titulo: 'Importe', clave: 'importe', tipo: 'dinero' },
      { titulo: 'Cajero', clave: 'cajero', tipo: 'texto' },
    ],
    filas,
    totales: { folio: 'TOTAL', importe: redondear(filas.reduce((s, f) => s + num(f.importe), 0)) },
    resumen: [
      ['Recargas cobradas', fmt(totalRecargas)],
      ['Comisión devuelta por MP', fmt(comision)],
      ['Neto que sale de MP', fmt(totalRecargas - comision)],
      ['Abonos a cuenta', fmt(totalAbonos)],
    ],
  };
}

const GENERADORES = {
  ventas: repVentas,
  cortes: repCortes,
  masVendido: repMasVendidos,
  devoluciones: repDevoluciones,
  recargas: repRecargasYAbonos,
};

/* ------------------------------------------------------------- pantalla */
function irAReporte(tipo) {
  REP.tipo = REPORTES[tipo] ? tipo : 'ventas';
  renderReporte();
}

function fijarNivelReporte(n) {
  REP.nivel = NIVELES[n] ? n : 'dia';
  renderReporte();
}

function renderReportes() {
  const cont = document.getElementById('rep-botones');
  if (cont) {
    cont.innerHTML = Object.entries(REPORTES).map(([k, r]) => `
      <button class="rep-boton ${REP.tipo === k ? 'activo' : ''}" onclick="irAReporte('${k}')">
        ${icono(r.ico, 22)}<span>${r.nombre}</span>
      </button>`).join('');
  }
  setVal('rep-desde', REP.desde);
  setVal('rep-hasta', REP.hasta);
  renderReporte();
}

function onPeriodoReporte() {
  REP.desde = document.getElementById('rep-desde')?.value || '';
  REP.hasta = document.getElementById('rep-hasta')?.value || '';
  renderReporte();
}

function renderReporte() {
  const cont = document.getElementById('rep-contenido');
  if (!cont) return;

  $$('#rep-botones .rep-boton').forEach((b, i) =>
    b.classList.toggle('activo', Object.keys(REPORTES)[i] === REP.tipo));

  const meta = REPORTES[REP.tipo];
  let datos;
  try {
    datos = GENERADORES[REP.tipo]();
  } catch (e) {
    console.error('[Reportes]', e);
    cont.innerHTML = `<div class="vacio"><div class="vacio-ico">${icono('alerta', 34)}</div>
      <h3>No se pudo armar el reporte</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  REP.datos = datos;

  const celda = (fila, col) => {
    const v = fila[col.clave];
    if (v === '' || v === undefined || v === null) return '';
    if (col.tipo === 'dinero') return fmt(v);
    if (col.tipo === 'numero') return fmtNum(v, num(v) % 1 ? 2 : 0);
    return esc(v);
  };
  const clase = (col, fila) => {
    if (col.tipo !== 'dinero' && col.tipo !== 'numero') return '';
    const v = num(fila[col.clave]);
    return 'der mono' + (v < 0 ? ' malo' : '');
  };

  cont.innerHTML = `
    <div class="rep-cabecera">
      <div>
        <h2>${meta.nombre}</h2>
        <p class="hint">${esc(CONFIG.negocio)} · ${etiquetaPeriodo()}${datos.nota ? ' · ' + esc(datos.nota) : ''}</p>
      </div>
      <div class="rep-acciones no-imprimir">
        <button class="btn btn-ghost" onclick="imprimirReporteActual()">${icono('imprimir')} Imprimir</button>
        <button class="btn btn-primary" onclick="exportarReporteCSV()">${icono('bajar')} Exportar CSV</button>
      </div>
    </div>

    ${REP.tipo === 'ventas' ? `
      <div class="rep-niveles no-imprimir">
        <span class="campo-lbl">Ver</span>
        ${Object.entries(NIVELES).map(([k, n]) => `
          <button class="chip ${REP.nivel === k ? 'activo' : ''}" onclick="fijarNivelReporte('${k}')">${n}</button>`).join('')}
      </div>` : ''}

    <div class="rep-resumen">
      ${datos.resumen.map(([k, v]) => {
        // La ganancia neta es el número que se busca: se ve distinto
        const fuerte = k === 'GANANCIA NETA';
        return `<div class="kpi ${fuerte ? 'destacado' : ''}"><span>${esc(k)}</span>
          <strong class="mono ${fuerte && num(String(v).replace(/[^0-9.-]/g, '')) < 0 ? 'malo' : ''}">${esc(v)}</strong></div>`;
      }).join('')}
    </div>

    ${!datos.filas.length
      ? `<div class="vacio"><div class="vacio-ico">${icono('carpeta', 34)}</div>
         <h3>Sin datos en este periodo</h3><p>Prueba con otras fechas o con “Todo”.</p></div>`
      : `<div class="tabla-scroll">
        <table class="tabla">
          <thead><tr>${datos.columnas.map(c =>
            `<th class="${c.tipo === 'dinero' || c.tipo === 'numero' ? 'der' : ''}">${esc(c.titulo)}</th>`).join('')}</tr></thead>
          <tbody>${datos.filas.map(f => `<tr>${datos.columnas.map(c =>
            `<td class="${clase(c, f)}">${celda(f, c)}</td>`).join('')}</tr>`).join('')}</tbody>
          <tfoot><tr>${datos.columnas.map(c => {
            const v = datos.totales[c.clave];
            if (v === undefined) return '<th></th>';
            const esNum = c.tipo === 'dinero' || c.tipo === 'numero';
            return `<th class="${esNum ? 'der mono' : ''}">${
              esNum ? (c.tipo === 'dinero' ? fmt(v) : fmtNum(v, num(v) % 1 ? 2 : 0)) : esc(v)}</th>`;
          }).join('')}</tr></tfoot>
        </table>
      </div>
      <p class="hint">${fmtNum(datos.filas.length)} renglón(es).</p>`}
  `;
}

/* ------------------------------------------------------------ exportar */
async function exportarReporteCSV() {
  const d = REP.datos;
  if (!d || !d.filas.length) { toast('No hay datos que exportar en este periodo.', 'warn'); return; }

  const nombreCol = d.columnas.map(c => c.titulo);
  const valor = (f, c) => {
    const v = f[c.clave];
    if (v === '' || v === undefined || v === null) return '';
    // Números sin formato: así Excel los suma sin tener que limpiarlos
    return (c.tipo === 'dinero' || c.tipo === 'numero') ? redondear(v) : v;
  };

  const filas = d.filas.map(f => d.columnas.map(c => valor(f, c)));
  const totales = d.columnas.map(c => {
    const v = d.totales[c.clave];
    if (v === undefined) return '';
    return (c.tipo === 'dinero' || c.tipo === 'numero') ? redondear(v) : v;
  });

  const encabezado = [
    [CONFIG.negocio],
    [REPORTES[REP.tipo].nombre],
    [etiquetaPeriodo()],
    ['Generado', fechaHoraCorta(new Date().toISOString())],
    [],
  ];
  const resumen = [...d.resumen.map(([k, v]) => [k, v]), []];

  const csv = [...encabezado, ...resumen, nombreCol, ...filas, totales]
    .map(f => f.map(celdaCSV).join(',')).join('\r\n');

  const archivo = `reporte_${REP.tipo}${REP.tipo === "ventas" ? "-" + REP.nivel : ""}_${REP.desde || 'inicio'}_${REP.hasta || hoyISO()}.csv`;
  if (await descargarArchivo(archivo, '﻿' + csv, 'text/csv')) {
    toast('Reporte exportado en CSV.', 'success');
  }
}

function imprimirReporteActual() {
  document.body.classList.add('imprimiendo-reporte-lista');
  window.print();
  setTimeout(() => document.body.classList.remove('imprimiendo-reporte-lista'), 800);
}

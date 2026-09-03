/* ============================================================================
   TANICHI · ICONOS
   Iconos de línea al estilo Lucide: viewBox 24, trazo 2, extremos redondeados
   y `currentColor`, para que hereden el color del texto en los estados
   invertidos (categoría activa, tarjeta presionada, botón turquesa).
   ========================================================================== */

const ICONOS = {
  /* --- categorías del catálogo (definidos en el diseño) --- */
  coffee:   ['M10 2v2', 'M14 2v2', 'M6 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1'],
  vaso:     ['m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8', 'M5 8h14', 'M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0', 'm12 8 1-6h2'],
  galleta:  ['M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5', 'M8.5 8.5v.01', 'M16 15.5v.01', 'M12 12v.01', 'M11 17v.01', 'M7 14v.01'],
  canasta:  ['m15 11-1 9', 'm19 11-4-7', 'M2 11h20', 'm3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4', 'M4.5 15.5h15', 'm5 11 4-7', 'm9 11 1 9'],
  rayo:     ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],

  /* --- dinero --- */
  billete:  ['M4 6h16v12H4z', 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M6 12h.01', 'M18 12h.01'],
  moneda:   ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M14.5 9.5h-4a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3h-4', 'M12 7v10'],
  tarjeta:  ['M3 5h18v14H3z', 'M3 10h18'],
  telefono: ['M7 2h10v20H7z', 'M11 18h2'],
  banco:    ['M3 21h18', 'M3 10h18', 'm12 3 9 5H3z', 'M5 10v11', 'M10 10v11', 'M14 10v11', 'M19 10v11'],
  cartera:  ['M3 7a2 2 0 0 1 2-2h13v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M18 12h4v4h-4a2 2 0 0 1 0-4z'],
  balanza:  ['M12 3v18', 'M7 21h10', 'M3 8h18', 'm6 8-3 6h6z', 'm18 8-3 6h6z'],
  candado:  ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],

  /* --- comercio --- */
  ticket:   ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  paquete:  ['m12 3 8 4.5v9L12 21l-8-4.5v-9z', 'm4 7.5 8 4.5 8-4.5', 'M12 12v9'],
  camion:   ['M2 6h11v11H2z', 'M13 9h4l3 3v5h-7z', 'M6 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  recibo:   ['M5 3h14v18l-2-1.5L15 21l-2-1.5L11 21l-2-1.5L7 21l-2-1.5z', 'M9 8h6', 'M9 12h6'],
  persona:  ['M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M4 21a8 8 0 0 1 16 0'],
  personas: ['M9 8m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0', 'M2 21a7 7 0 0 1 14 0', 'M17 4.5a3.5 3.5 0 0 1 0 7', 'M18 14a7 7 0 0 1 4 7'],

  /* --- interfaz --- */
  buscar:   ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'm20 20-3.5-3.5'],
  mas:      ['M12 5v14', 'M5 12h14'],
  menos:    ['M5 12h14'],
  cerrar:   ['M18 6 6 18', 'm6 6 12 12'],
  palomita: ['M20 6 9 17l-5-5'],
  alerta:   ['m12 3 9.5 17h-19z', 'M12 9v5', 'M12 17.5v.01'],
  reloj:    ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 7v5l3.5 2'],
  bote:     ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6', 'M14 11v6'],
  lapiz:    ['M4 20h4L20 8l-4-4L4 16z', 'm14 6 4 4'],
  imprimir: ['M7 8V3h10v5', 'M5 8h14v8H5z', 'M7 14h10v7H7z'],
  bajar:    ['M12 3v13', 'm7 12 5 5 5-5', 'M4 21h16'],
  subir:    ['M12 21V8', 'm7 12 5-5 5 5', 'M4 3h16'],
  grafica:  ['M4 21V3', 'M4 21h17', 'M8 17v-6', 'M13 17V7', 'M18 17v-9'],
  carpeta:  ['M3 6h6l2 3h10v11H3z'],
  ojo:      ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  ajustes:  ['M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z'],
  calendario:['M5 5h14v16H5z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  regresar: ['M20 12H4', 'm10 6-6 6 6 6'],
  sol:      ['M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M12 2v2', 'M12 20v2', 'm4.9 4.9 1.4 1.4', 'm17.7 17.7 1.4 1.4', 'M2 12h2', 'M20 12h2', 'm6.3 17.7-1.4 1.4', 'm19.1 4.9-1.4 1.4'],
  luna:     ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  estrella: ['m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z'],
  etiqueta: ['M3 3h8l10 10-8 8L3 11z', 'M7.5 7.5v.01'],
};

/** Devuelve el SVG de un icono como texto, para interpolar en plantillas. */
function icono(nombre, tam = 18) {
  const d = ICONOS[nombre];
  if (!d) return '';
  return `<svg class="ico" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${d.map(p => `<path d="${p}"/>`).join('')}</svg>`;
}

/** Rellena los <span data-ico="nombre"> del documento (o de una rama). */
function pintarIconos(raiz = document) {
  raiz.querySelectorAll('[data-ico]:empty').forEach(el => {
    el.innerHTML = icono(el.getAttribute('data-ico'), num(el.getAttribute('data-tam'), 18));
  });
}

/** Icono para una categoría del catálogo: las del diseño tienen el suyo,
 *  el resto cae en una etiqueta genérica. */
function iconoCategoria(cat) {
  const c = String(cat || '').toLowerCase();
  if (/caf|bebida caliente/.test(c)) return 'coffee';
  if (/bebida|refresco|agua|jugo|coca|pepsi|lala|l[áa]cteo/.test(c)) return 'vaso';
  if (/botana|dulce|sabritas|barcel|gamesa|galleta|yorica|memin/.test(c)) return 'galleta';
  if (/abarrote|vitrina|kowi|coyote|bimbo|marinela/.test(c)) return 'canasta';
  if (/servicio|recarga|f[áa]rmaco|cigarro|compras/.test(c)) return 'rayo';
  if (c === 'todas') return 'canasta';
  if (c === CAT_TOP) return 'estrella';
  return 'etiqueta';
}

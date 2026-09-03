# TANICHI · Punto de venta + Corte de caja

Sistema de tienda para cobrar y cuadrar la caja sin doble captura: vendes en el
**punto de venta** y, al cerrar el turno, el **corte de caja** ya viene lleno con
lo que se vendió.

No necesita instalación, ni cuenta de nada. Los datos —ventas, inventario, fiados—
se guardan en el navegador del equipo donde se usa; nada sale de ahí salvo que tú
exportes un respaldo.

---

## Cómo se usa

Doble clic en **`TANICHI.bat`**. Abre en su propia ventana, sin barra de
direcciones, y sirve la app desde un servidor local (PowerShell, ya viene en
Windows: no hay que instalar nada más).

Dentro de la app, en **Ajustes → Instalar como aplicación**, queda con su
propio ícono en el escritorio y funciona **sin internet**.

### El día a día

1. **Apertura** — Cuentas el fondo con el que arrancas y anotas los saldos
   iniciales de Mercado Pago, cartera y —si la usas— tu tarjeta de crédito.
2. **Punto de venta** — Cobras, con lector de código de barras o buscando por
   nombre. También hay *venta libre*, *recargas*, *envío de dinero* con
   comisión, y *abonos* de clientes fiados.
3. **Fiados** — La cuenta de cada persona se arma sola a partir de las ventas
   fiadas; también se puede dar de alta una deuda que ya traías en papel.
4. **Corte de caja** — Capturas los egresos del turno —cada uno con la cuenta
   de la que salió: caja, cartera, Mercado Pago o tarjeta de crédito—, cuentas
   el efectivo final y el sistema te dice si cuadra, y si no, dónde buscar.
5. **Reportes** — Ventas y ganancias netas, más vendidos, devoluciones,
   recargas y abonos, todo exportable a CSV.

---

## Actualizarla

**Ajustes → Buscar actualización.** Descarga la última versión publicada aquí
y reemplaza los archivos del programa en el equipo. Tus datos no se tocan:
viven en el navegador, no en estos archivos.

Ese botón sólo aparece cuando la app corre por `TANICHI.bat` (necesita el
servidor local para escribir en disco). Si algo queda a medias, **Ajustes →
Buscar versión nueva** limpia la copia guardada y vuelve a leer del servidor.

---

## Estructura del proyecto

```
index.html          La página, con todas las vistas
style.css           El sistema de diseño (Modernist: turquesa, rojo, sin radios)
js/
  core.js           Almacenamiento, utilidades, temas, modales
  turno.js          El turno compartido entre POS y corte; ahí vive el cuadre
  pos.js            Catálogo, carrito, cobro, tickets, egresos, envíos
  inventario.js     Catálogo de productos, importar/exportar CSV
  corte.js          Apertura, denominaciones, saldos, cuadre, reporte
  historial.js      Cortes guardados y sus gráficas
  reportes.js       Ventas y ganancias, más vendidos, devoluciones…
  fiados.js         Cuentas por cobrar y consulta de tickets
  fotos.js          Fotos de producto (recorte y compresión en el navegador)
  app.js            Arranque, navegación, ajustes, actualizaciones
servidor-tanichi.ps1  Servidor local (PowerShell): sirve la app y el endpoint
                      de actualización
TANICHI.bat           Lanzador: arranca el servidor y abre la app
manifest.json, sw.js  La app instalable y su modo sin internet
```

## Herramientas de este repositorio (no forman parte de la app)

- `construir-artifact.js` — empaqueta todo en un solo archivo HTML, para
  publicar como página independiente
- `convertir-inventario.py` — convierte un export de SUMA Punto de Venta al
  CSV que entiende Inventario → Importar CSV

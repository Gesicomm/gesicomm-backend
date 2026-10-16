# Feed por URL para Meta

## Dónde está

Catálogo de Productos → **Productos en mi landing** → **Exportar a Meta**.
El panel muestra el enlace y permite preparar, actualizar y pausar el feed.
La opción aparece exclusivamente en esa pestaña de la vitrina.

La pestaña del catálogo resuelve la landing de la tienda activa con la misma
prioridad que su listado: página de catálogo, inicio y después la más reciente.
Se exportan únicamente los productos/combinaciones guardados en esa landing,
activos, en venta y visibles para esa tienda. No se exporta todo el catálogo
general ni se incluyen productos nuevos de proveedores automáticamente.
Los filtros de búsqueda y la página visible no recortan el enlace: representa
el conjunto completo de productos publicados en esa landing.

## Configuración en Meta

1. Preparar el feed y esperar a que aparezca la fecha de generación.
2. Copiar el enlace. Ejemplo genérico:
   `https://tienda.example/api/l/feed-productos.csv?landing=123`.
3. Commerce Manager → catálogo → Orígenes de datos → Agregar artículos →
   Feed de datos → usar URL.
4. Pegar el enlace y configurar descargas programadas. Moneda: PYG.
5. Revisar los resultados y rechazos en Commerce Manager.

No hace falta conectar la cuenta de Meta a Gesicomm ni un token de catálogos.
El enlace contiene información comercial pública: compartirlo permite descargar
ese surtido, sus precios públicos y su disponibilidad, sin costos ni clientes.

## Qué se actualiza

El archivo usa el DTO público de la landing: precios de venta efectivos,
promociones vigentes, textos personalizados, imágenes, marca y stock de la
tienda. No recalcula precios desde costos del proveedor por su cuenta.
Los IDs se comparten con los eventos Pixel/CAPI y quedan fijados al crear
el producto; editar su slug no cambia la identidad histórica.

El proceso del backend recorre los feeds activos cada minuto. La aparición
en Meta depende de su descarga programada y procesamiento; no se garantiza
actualización en cinco minutos. Última descarga registra cualquier acceso al
archivo y no certifica aprobación de Meta.

Pausar responde 503; no entrega un archivo vacío para evitar bajas accidentales.
Los productos ya importados pueden permanecer en Meta. Retirarlos o borrar el
origen se administra explícitamente en Commerce Manager. Las bajas de la
landing se reflejan en el archivo siguiente; el comportamiento de reemplazo
depende de la configuración elegida para ese origen en Meta.

## Operación

- Ejecutar `npx sequelize-cli db:migrate` antes de iniciar una versión nueva.
- Migraciones: `20261016200000-meta-feed-url` y
  `20261016210000-repair-meta-feed-landing`. La segunda corrige tablas creadas
  por la primera versión; conserva los registros y pausa los que no tienen
  una landing de inicio identificable.
- `META_FEED_DIR`: directorio privado persistente para snapshots. Montarlo
  en un volumen compartido si se sirven peticiones desde varias réplicas.
- `META_FEED_MAX_ITEMS`: capacidad técnica por feed, por defecto 5000.
  No equivale a una cuota comercial de planes.
- El backend debe permanecer encendido para actualizar los archivos.
- Nunca se sirve el CSV mientras se está generando: se construye en un archivo
  temporal, en lotes de hasta 40 fichas, y se publica completo. Un fallo conserva
  la última versión. Bloqueo PostgreSQL por landing y revisión de configuración
  impiden que dos procesos publiquen simultáneamente una generación antigua.

## Pruebas

Pruebas aisladas con PostgreSQL local en 127.0.0.1:55439, nunca con `.env` de
producción. `META_FEED_TEST_DATABASE_URL` debe apuntar explícitamente a esa
instancia. Suite: `src/tests/metaFeed.integration.test.js`. Incluye dos tiendas,
precios/enlaces distintos, selección, cambios de stock, reposición, IDs estables,
fallos/reintentos, pausa, reparación de esquema y cargas de 500/1000/2000.
La resolución de la landing activa y su aislamiento tienen pruebas del
controlador; el acceso y la visualización del enlace en Productos en mi landing
están cubiertos por `VitrinaGrid.test.jsx`.

Estas pruebas no certifican importación ni aprobación de artículos dentro de
Meta; ese último paso requiere configurar el origen en Commerce Manager.

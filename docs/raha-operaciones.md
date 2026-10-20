# Operaciones del portal RAHA

El portal `/raha/solicitudes` conserva Documentación y agrega las pestañas
Abastecimientos, Envíos a RAHA y Depósitos RAHA. Los pagos anticipados,
cuentas bancarias y comprobantes quedan fuera de esta etapa.

## Instalación

Aplicar `20261019140000-raha-operaciones.js` antes de publicar el backend.
Aplicar después `20261019160000-raha-envios-estados-logisticos.js` para
habilitar Preparado, Enviado y Recibido. Esta segunda migración puede
repetirse; su reversión se bloquea si ya existen envíos en esos estados.
Crea `raha_destinos` y `raha_envios_stock`; no transforma ni modifica
solicitudes de ingreso o pedidos logísticos existentes.

RAHA debe publicar al menos un depósito de recepción activo desde su nueva
pestaña. No se generan ubicaciones ficticias ni se confunden los centros
genéricos de Gesicom con depósitos de RAHA.

## Abastecimientos existentes

La sesión Bearer propia del portal RAHA habilita:

- `POST /api/raha-portal/operaciones/abastecimientos`.
- `GET /api/raha-portal/operaciones/abastecimientos/:id`.

El listado admite `texto`, `estado` remoto, `desde`, `hasta`, `page` y
`limit`. Incluye solo solicitudes a depósitos propios que tengan un mapeo
de integración RAHA en el ambiente activo. El detalle muestra los eventos
procesados del pedido, usuario y ambiente correspondientes. Esta vista no
permite reemplazar manualmente los estados que informa la API logística.
No expone credenciales, errores internos ni payloads de integración.

## Solicitudes de enviar mercadería hacia RAHA

El comercio accede desde Mis depósitos a `/mis-envios-raha`. Sus endpoints,
con sesión Gesicom y tienda activa, están en
`/api/integraciones/raha/operaciones`:

- `GET /destinos`: destinos RAHA activos y publicados.
- `GET /origenes`: depósitos propios activos de la tienda autenticada.
- `POST /stock`: catálogo permitido completo con existencias del origen; acepta
  `deposito_origen_id`, `texto`, `page`, `limit`.
- `POST /envios`: crea la solicitud. Requiere conexión RAHA aprobada,
  `deposito_origen_id`, `destino_raha_id`, `solicitud_key` UUID y `items`
  con `producto_id`, `variante_id` nullable y `cantidad` entera positiva;
  `observacion` es opcional. Máximo 100 productos/variantes distintos.
- `POST /envios/listado`: filtros `texto`, `estado`, `desde`, `hasta`,
  `page`, `limit`; nunca puede sobrescribir usuario o tienda desde el body.
- `GET /envios/:id`: detalle del propietario en la tienda activa.
- `POST /envios/:id/resolver`: el comercio marca `preparado` desde
  `solicitada` o `aceptada`, y `enviado` desde `preparado`. Puede cancelar
  antes del envío. Exige `estado`, `version` actual y `comentario` opcional.

El catálogo incluye productos propios de la tienda y productos publicados
por administradores del mismo inquilino, con variantes activas y paginación
en servidor. No muestra productos privados de otras tiendas o inquilinos.
Si existe una fila de inventario en el origen, se valida su disponibilidad;
si no existe, permite declarar la cantidad para coordinar el envío y la
identifica como `stock_registrado: false`, sin inventar existencias.
Nombres, SKU, variantes,
dirección de origen y destino se guardan como snapshots del servidor.
Reintentar la misma solicitud con su UUID devuelve el registro existente;
reutilizar la clave con otro contenido devuelve 409. Las respuestas
excluyen el hash interno y la clave idempotente.

El portal RAHA dispone de `POST /operaciones/envios/listado`,
`GET /operaciones/envios/:id` y `POST /operaciones/envios/:id/resolver` bajo
su propia sesión. Puede aceptar, observar o rechazar solicitudes pendientes
o con observaciones. Observación y rechazo requieren un motivo. Las
solicitudes `enviado` pueden marcarse `recibido` exclusivamente desde RAHA.
La confirmación de recibido no puede anticiparse al envío. Todas las
resoluciones bloquean el registro, verifican la versión y agregan historial
con autor y fecha. Las cookies Gesicom no autentican al portal.

Los listados responden `{ registros, total, page, limit, totalPaginas }`.
Las fechas son inclusivas en Asunción y se validan en el servidor. El
límite máximo por página es 100.

## Alcance del movimiento físico

Una solicitud coordina un futuro traslado: **no reserva ni descuenta stock**
y aceptarla **no acredita inventario recibido**. No se invoca la API de
pedidos de compra para representar un envío de productos del comercio.
Los estados son `solicitada`, `observada`, `aceptada`, `preparado`, `enviado`,
`recibido`, `rechazada` y `cancelada`. Recibido registra la confirmación del
operador, pero su integración con el movimiento de inventario queda para
la etapa de transferencias. Esta distinción se muestra en ambas interfaces.

## Accesos y verificación end-to-end

Mis depósitos presenta cuatro acciones de ancho completo, en este orden:
Agregar depósito, Abastecerme, Ver RAHA y Enviar mercadería a RAHA.
Abastecerme permite elegir entre todos los depósitos propios activos de la
tienda, independientemente de la página o filtros del listado.
Ver RAHA abre `/mis-abastecimientos`; el último acceso abre `/mis-envios-raha`.

Desde el backend ejecutar `node test-raha/run.cjs`. Requiere dependencias
instaladas en ambos proyectos, Chromium de Playwright y binarios PostgreSQL
17 (o `RAHA_E2E_PG_BIN`). Crea un clúster PostgreSQL descartable con puerto
libre, aplica las migraciones reales y usa rutas Express/autenticación
reales desde Chromium. No usa la base configurada en `.env`, no simula las
API de negocio y no contacta servicios externos. Guarda `report.json`, logs
y capturas en `outputs/raha-e2e-<timestamp>` y detiene sus propios procesos.

## Destinos publicados

`GET/POST /api/raha-portal/operaciones/destinos` y
`PUT /api/raha-portal/operaciones/destinos/:id` permiten a un operador
autenticado gestionar nombre, ciudad, dirección, contacto, teléfono y
estado activo. Los comercios solo pueden seleccionar destinos activos;
desactivarlos no altera los snapshots de solicitudes anteriores.

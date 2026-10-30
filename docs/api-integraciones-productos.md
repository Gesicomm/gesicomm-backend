# API de Productos de Gesicom

Esta es la API que usa un **proveedor** para ofrecer su mercadería en
Gesicom. Conectás tu sistema una vez, nos mandás tu catálogo, y tus
productos quedan disponibles para que los comercios de Gesicom los
publiquen en sus tiendas, sus landings y sus páginas de venta.

> **Si sos proveedor, lo que te interesa es todo este documento.** Empezá
> por la sección 1 (cómo conseguir tu API Key), seguí por la 2 (tu catálogo
> pasa por revisión) y después el contrato técnico.

La misma API sirve para un segundo caso: un **comercio** que ya tiene su
tienda en Gesicom y quiere sincronizar su propio catálogo desde su ERP. Es
el mismo contrato; lo único que cambia es a qué catálogo escribe cada key
(sección 1, al final).

Backend: `src/services/integracionProductos.service.js` (la API),
`src/services/revisionCatalogoProveedor.service.js` (la revisión del
administrador), `src/controllers/integracionProductosAdmin.controller.js`
(alta de keys, con sesión) y `src/controllers/integracionProductosApi.controller.js`
(lo que consume el proveedor), montados en `src/routes/integracionesProductosAdmin.js`
y `src/routes/integracionesProductosApi.js`. Autenticación:
`src/middleware/autenticacionIntegracion.js`.

Migraciones: `migrations/20261009130000-create_integracion_productos.js` y
`migrations/20261030210000-revision-productos-proveedor.js`. Las aplica
`server.js` en cada arranque (son idempotentes), así que se ejecutan solas
al desplegar — ver "Antes de usar esto en producción" al final.

---

## Cómo funciona, en una frase

Tu sistema nos **manda** (`push`) tus productos con tu API Key. Gesicom
nunca te consulta ni te pide nada: toda la iniciativa es tuya.

- **Carga inicial**: un solo request con todo tu catálogo (`POST /productos/lote`).
- **Día a día**: un request por cada alta o cambio real (`POST /productos`,
  `PATCH .../stock`, `PATCH .../precio`, `DELETE /productos/:sku`).

---

## 1. Conseguir tu API Key

**La key te la entrega Gesicom.** No se genera sola ni se pide por la API:
un administrador da de alta tu proveeduría y te pasa la key por un canal
privado.

Para darte de alta hacen falta dos cosas:

| Dato | Para qué |
|---|---|
| **Nombre del proveedor** | Es como te van a ver los comercios al filtrar el catálogo por proveedor. |
| **Logo** (URL `https://` pública) | Un logo chico, cuadrado. Aparece sobre la tarjeta de cada uno de tus productos en el catálogo, para que se reconozca de un vistazo que son tuyos. Si no mandás uno, se muestra solo tu nombre. |

Del lado de Gesicom, un administrador lo hace así (sesión de administrador):

```
POST /api/integraciones/productos/proveedores
{ "nombre": "Quanta", "logo_url": "https://cdn.quanta.com.py/logo.png" }
```

```json
// 201
{
  "id": 4,
  "nombre": "Quanta",
  "codigo": "quanta",
  "tipo": "proveedor",
  "proveedor_id": 12,
  "logo_url": "https://cdn.quanta.com.py/logo.png",
  "api_key_prefix": "gsk_7F3aQ9xZ",
  "activo": true,
  "api_key": "gsk_7F3aQ9xZmK2b...(43 caracteres más)"
}
```

⚠️ **`api_key` se muestra una sola vez, en esa respuesta.** Gesicom guarda
únicamente su hash (SHA-256): ni un administrador puede recuperarla
después. Si se pierde, se revoca y se emite otra.

- `GET /api/integraciones/productos/proveedores` — las keys de proveedor
  dadas de alta, sin la key completa (solo el prefijo, para reconocerla).
- `DELETE /api/integraciones/productos/proveedores/:id` — revoca. No se
  borra (queda la auditoría); la key revocada responde `403
  INTEGRACION_INACTIVA`. Los productos ya aprobados siguen publicados.

### Si sos un comercio sincronizando tu propio ERP

Ese caso no pasa por un administrador: lo hacés vos desde tu panel, con el
permiso `gestionar_integraciones` y una tienda activa seleccionada (si no
hay ninguna, responde `409 TIENDA_NO_SELECCIONADA`).

`POST /api/integraciones/productos/credenciales` con `{ "nombre": "ERP
propio" }` devuelve la key con la misma forma de arriba (y `tipo:
"tienda"`). `GET` del mismo endpoint las lista sin la key completa, y
`DELETE /api/integraciones/productos/credenciales/:id` la revoca. Lo que
entra con una key así es solo de tu tienda y no lo ve ningún otro
comercio; tampoco pasa por la revisión de la sección 2, porque es tu
propio catálogo.

---

## 2. Tu catálogo pasa por revisión

**Nada de lo que subas se publica automáticamente.** Cada producto nuevo
que mandás queda esperando a que un administrador de Gesicom lo mire. Esto
no es un trámite: es el control de qué se vende en la plataforma.

```
Tu POST  →  pendiente  →  el administrador lo mira  →  aprobado → se publica
                                                   ↘  rechazado → no se publica (con motivo)
```

- Mientras está **pendiente**, el producto existe en Gesicom pero no lo ve
  ningún comercio ni aparece en ninguna tienda.
- **Aprobado**, queda disponible para todos los comercios, con tu logo en
  la tarjeta.
- **Rechazado**, no se publica y queda guardado el motivo.

Qué conviene saber:

- **Podés seguir mandando cambios mientras espera.** Corregir el precio,
  las fotos o la descripción de un producto pendiente es normal y no
  reinicia nada. Lo que no podés es publicarlo vos: mandar `"activo": true`
  no saltea la revisión.
- **La revisión es por producto, no por lote.** De 50 productos pueden
  aprobarte 48.
- **Un producto ya aprobado no vuelve a revisión** cuando le cambiás el
  precio o el stock. Mandá los cambios con confianza.
- **Mandá fotos y descripciones de verdad.** Un producto sin foto o con
  una descripción de una línea es el que más se demora, porque del otro
  lado no hay con qué decidir.
- **Lo que no se acepta**: lo que no se puede vender legalmente en
  Paraguay (armas, drogas, medicamentos de venta bajo receta, fauna
  protegida), productos falsificados o que usan marcas de terceros sin
  autorización, y cualquier cosa que no coincida con lo que la foto o el
  texto prometen.

Hoy la decisión no te llega por mail: coordinala por el canal que ya
tenés con Gesicom.

---

## 3. Autenticación de la API pública

Todos los endpoints de abajo van en:

```
Authorization: Bearer gsk_7F3aQ9xZmK2b...
```

No hay sesión, cookie ni tenant por separado: la API Key sola identifica
qué comercio es y a qué catálogo puede escribir.

| Código HTTP | `codigo` | Motivo |
|---|---|---|
| 401 | `API_KEY_FALTANTE` | No se mandó el header `Authorization`. |
| 401 | `API_KEY_INVALIDA` | La key no existe (o está mal copiada). |
| 403 | `INTEGRACION_INACTIVA` | La key fue revocada desde el panel. |

Probá la key con:

`GET /api/integraciones/productos/v1/ping` → `200 { "ok": true, "integracion": "erp-propio" }`

---

## 4. Identificación del producto: el campo `sku`

**`sku` es el identificador que USTEDES ya usan en su propio sistema.**
Gesicomm lo guarda internamente asociado a esta integración (tabla
`integracion_productos`) — es la clave que decide si un request crea un
producto nuevo o actualiza uno existente. Mandá siempre el mismo `sku` para
el mismo producto.

No hace falta que el `sku` sea único entre comercios distintos: cada
integración tiene su propio espacio de SKUs. (Si por casualidad choca con
el SKU interno de otro producto de Gesicomm, el sistema lo prefija
automáticamente — esto es transparente para ustedes, el `sku` que usan
sigue siendo el mismo en todos los requests siguientes.)

---

## 5. Crear o actualizar un producto (upsert)

`POST /api/integraciones/productos/v1/productos`

⚠️ **Regla de "upsert parcial":** `nombre`, `precio`, `stock` y `activo`
son el estado completo del producto y se aplican siempre tal cual los
mandes. El resto de los campos (`categoria`, `marca`, `descripcion`,
`descripcion_corta`, `precio_comparacion`, `peso_kg`, `dimensiones`,
`destacado`, `tags`, `imagenes` y cada clave de `ficha`) solo se tocan **si
los incluís en el request**. Si creaste un producto mandando `marca: "Nike"`
y después mandás un upsert del mismo `sku` solo para actualizar el precio
(sin el campo `marca`), la marca sigue siendo "Nike" — no se borra. Para
borrar alguno de esos campos, mandalo explícito (`"marca": null`,
`"tags": []`).

### Request body

```json
{
  "sku": "ABC-123",
  "nombre": "Zapatilla Running Pro",
  "descripcion": "Texto largo de descripción, puede tener varios párrafos.",
  "descripcion_corta": "Zapatilla liviana para running de calle.",
  "categoria": "Calzado deportivo",
  "marca": "Nike",
  "precio": 450000,
  "precio_comparacion": 550000,
  "moneda": "PYG",
  "stock": 25,
  "peso_kg": 0.6,
  "activo": true,
  "imagenes": [
    "https://cdn.tutienda.com/zapatilla-1.jpg",
    "https://cdn.tutienda.com/zapatilla-2.jpg"
  ],
  "tags": ["running", "deportivo"]
}
```

### Campos

| Campo | Obligatorio | Tipo | Notas |
|---|---|---|---|
| `sku` | **Sí** | string (≤100) | Su identificador. Ver sección 4. |
| `nombre` | **Sí** | string | |
| `precio` | **Sí** | número ≥ 0 | Guaraníes, **sin decimales** (ej: `450000`, no `450000.00`). |
| `stock` | **Sí** | entero ≥ 0 | Las unidades disponibles del producto, un solo número. |
| `moneda` | No | string | Si se manda, tiene que ser `"PYG"` — es lo único que se acepta hoy. |
| `descripcion` | No | string | Texto largo (HTML plano, sin tags). |
| `descripcion_corta` | No | string (≤500) | |
| `categoria` | No | string | Nombre libre. Si no existe, Gesicomm la crea. No hay jerarquía (ej. `"Calzado > Running"`) en esta versión — se guarda tal cual como una categoría plana. |
| `marca` | No | string | Igual que categoría: se busca por nombre o se crea. |
| `precio_comparacion` | No | número ≥ 0 | Precio "tachado" que se muestra como referencia de descuento. |
| `peso_kg` | No | número | Para cálculo de envío. |
| `dimensiones` | No | string (≤100) | Formato libre, ej: `"30x20x10 cm"`. |
| `destacado` | No (default `false`) | boolean | Lo marca como destacado en el catálogo del comercio. |
| `activo` | No (default `true`) | boolean | `false` = producto dado de baja (no se borra, deja de mostrarse). |
| `ficha` | No | objeto | Todo el contenido de la página del producto: propuesta de valor, beneficios, confianza, opiniones, preguntas y los textos de cada bloque. Ver la sección siguiente. |
| `imagenes` | No | array de URLs `https://` | Máx. 20. **Reemplaza la lista completa** cuando la mandás: si el array trae URLs, esas pasan a ser TODAS las imágenes (se borran las anteriores); si mandás `imagenes: []` explícito, se borran todas. Si **no incluís el campo**, las imágenes existentes no se tocan (ver recuadro de "upsert parcial" arriba). La primera URL del array es la imagen principal. Gesicomm no descarga ni re-hostea estas imágenes: las muestra directo desde tu URL, así que tienen que ser URLs estables y públicas. |
| `tags` | No | array de strings | Máx. 30. |

### Response

```json
// 200 si ya existía (match por sku), 200 también si se creó (ver "accion")
{
  "ok": true,
  "accion": "creado",          // o "actualizado"
  "producto_id": 4821,
  "sku": "ABC-123",
  "slug": "zapatilla-running-pro",
  "activo": true
}
```

### Errores posibles

```json
{ "ok": false, "error": "El campo \"sku\" es obligatorio (máx. 100 caracteres).", "codigo": "SKU_INVALIDO" }
```

| `codigo` | HTTP | Motivo |
|---|---|---|
| `PAYLOAD_INVALIDO` | 400 | El body no es un objeto JSON válido. |
| `SKU_INVALIDO` | 400 | Falta `sku` o supera 100 caracteres. |
| `NOMBRE_INVALIDO` | 400 | Falta `nombre`. |
| `PRECIO_INVALIDO` | 400 | Falta `precio` o es negativo/no numérico. |
| `STOCK_INVALIDO` / `STOCK_REQUERIDO` | 400 | Falta `stock` (o el desglose) o es inválido. |
| `MONEDA_NO_SOPORTADA` | 400 | Mandaste una moneda que no sea `PYG`. |
| `CONFLICTO_CONCURRENCIA` | 409 | Dos operaciones simultáneas sobre el mismo `sku`. Reintentá la misma operación. |
| `FICHA_INVALIDA` | 400 | `ficha` no es un objeto JSON. |
| `FICHA_BENEFICIOS_INVALIDOS` / `FICHA_CONFIANZA_INVALIDA` / `FICHA_PREGUNTAS_INVALIDAS` / `FICHA_OPINIONES_INVALIDAS` / `FICHA_INCLUYE_INVALIDO` | 400 | Esa clave de `ficha` tiene que ser un array. |
| `FICHA_TEXTOS_INVALIDOS` | 400 | `ficha.textos` no es un objeto, o trae un nombre de texto que no existe (el error lista los válidos). |

### La ficha del producto: el campo `ficha`

El `nombre`, el `precio` y las `imagenes` alcanzan para que el producto
aparezca en el catálogo, pero **su página queda casi vacía**: la ficha de
producto de Gesicomm no inventa textos, así que cada bloque que no tenga
datos se oculta solo. `ficha` es lo que llena esa página.

Lo que entra por acá queda **en el producto**, no en una landing: vale en
el catálogo del comercio y en todas las tiendas donde se venda, y el
comercio lo puede seguir editando desde el panel (Productos → Vista del
producto). Si el comercio después edita un texto a mano, **lo suyo gana**
sobre lo que manden ustedes en el próximo upsert.

```json
{
  "sku": "ABC-123",
  "nombre": "Zapatilla Running Pro",
  "precio": 450000,
  "stock": 25,
  "descripcion": "Texto largo. Se respetan los saltos de línea.",
  "ficha": {
    "insignia": "MÁS VENDIDA",
    "propuesta_valor": "Amortiguación para 800 km de calle",
    "beneficios": [
      { "titulo": "Peso 240 g", "texto": "Más liviana que su versión anterior" },
      "Plantilla extraíble"
    ],
    "confianza": [
      { "titulo": "Cambio sin costo", "texto": "30 días para cambiar el talle", "icono": "shield" }
    ],
    "opiniones": [
      { "nombre": "Lucía G.", "comentario": "Las uso todos los días, cero molestias.", "calificacion": 5, "detalle": "Google Reviews" }
    ],
    "preguntas": [
      { "pregunta": "¿Cómo calzan?", "respuesta": "Fieles al talle." }
    ],
    "preguntas_titulo": "Dudas frecuentes",
    "incluye_pedido": ["1 par de zapatillas", "Bolsa de transporte"],
    "textos": {
      "beneficios_titulo": "Por qué la eligen",
      "opiniones_kicker": "Opiniones reales"
    }
  }
}
```

| Clave de `ficha` | Tipo | Dónde se ve |
|---|---|---|
| `insignia` | string (≤24) | Etiqueta corta **sobre la foto** en el catálogo (`"OFERTA"`, `"MÁS VENDIDO"`). No es una descripción: si mandás una frase, la tarjeta queda ilegible. |
| `propuesta_valor` | string (≤300) | La frase destacada debajo del nombre, arriba de la descripción. |
| `sobre_el_producto` | string | Texto largo adicional, para el panel y las fichas por rubro. La descripción que se ve en la página es `descripcion` (fuera de `ficha`). |
| `beneficios` | array (≤8) | Bloque "Beneficios principales": los checks rápidos antes de comprar. Cada item es `{ titulo, texto, icono }` o un string (solo título). **La ficha muestra los 4 primeros, y solo el título.** |
| `confianza` | array (≤8) | Bloque "Zona de confianza" (garantía, envío, devoluciones). Mismo formato que `beneficios`. |
| `preguntas` | array (≤20) | Bloque "Preguntas frecuentes". Cada item es `{ pregunta, respuesta }`; sin las dos cosas, el item se descarta. |
| `preguntas_titulo` | string (≤255) | Título del bloque de preguntas. |
| `opiniones` | array (≤9) | Bloque "Opiniones", y de acá salen **las estrellas y el "4,8 de 5 · 32 opiniones"** debajo del nombre. Cada item es `{ nombre, comentario, calificacion (1-5), detalle, foto }`. `detalle` es de dónde viene la opinión (ej. `"Google Reviews"`) y se muestra bajo el nombre. Un item **sin `comentario` se descarta**. Mandá solo opiniones reales de sus clientes. |
| `incluye_pedido` | array (≤8) | Bloque "Qué incluye tu pedido". Strings o `{ texto }`, ≤120 caracteres cada uno. |
| `textos` | objeto | Los rótulos y títulos de cada bloque. Nombres válidos: `insignia_principal` (≤40), `insignia_secundaria` (≤40), `titulo_comercial` (≤100), `cta_texto` (≤60), `agregar_carrito_texto` (≤40), `beneficios_kicker`/`urgencia_kicker`/`opiniones_kicker`/`preguntas_kicker` (≤60), `beneficios_titulo`/`urgencia_titulo`/`opiniones_titulo`/`preguntas_titulo` (≤90), `beneficios_subtitulo`/`urgencia_texto`/`opiniones_subtitulo`/`preguntas_subtitulo` (≤180). Un nombre que no esté en esa lista hace fallar el request (`FICHA_TEXTOS_INVALIDOS`) en vez de guardarse en silencio. |

Reglas de `ficha`, clave por clave:

- **No mandar una clave** = no se toca lo que ya estaba cargado.
- **Mandarla vacía** (`[]`, `""`, `{}`) = borrarla: ese bloque deja de
  mostrarse. Es la forma de dar de baja un contenido, no hay un endpoint
  aparte.
- **`ficha: null`** vacía todos los textos de `textos` (los `textos` nada
  más, no las listas).
- Los textos de una sola línea se normalizan (saltos y espacios dobles se
  colapsan) y se recortan al tope de su columna; `descripcion` y las
  `respuesta` de las preguntas **conservan los saltos de línea**.

---

## 6. Carga inicial completa (lote)

`POST /api/integraciones/productos/v1/productos/lote`

Pensado para la primera sincronización, cuando hay que mandar todo el
catálogo de una vez.

```json
{
  "productos": [
    { "sku": "ABC-123", "nombre": "Zapatilla Running Pro", "precio": 450000, "stock": 25 },
    { "sku": "ABC-124", "nombre": "Zapatilla Trail", "precio": 480000, "stock": 10 }
  ]
}
```

- Cada elemento de `productos` tiene exactamente la misma forma que el
  `POST /productos` de la sección 5.
- **Máximo 200 productos por request.** Si tenés más, mandá varios lotes.
- Cada producto se procesa en su propia transacción: si uno falla, los
  demás se procesan igual (no se cancela el lote entero).
- Reenviar el mismo lote dos veces es seguro: cada item es un upsert por
  su propio `sku`, así que el catálogo queda en el mismo estado.

### Response

```json
{
  "ok": true,
  "procesados": 2,
  "creados": 2,
  "actualizados": 0,
  "errores_total": 0,
  "errores": []
}
```

Si algún producto del lote falla, aparece en `errores` (se listan hasta
50; `errores_total` es el conteo real):

```json
{ "errores": [ { "sku": "ABC-999", "error": "El campo \"precio\" es obligatorio...", "codigo": "PRECIO_INVALIDO" } ] }
```

---

## 7. Actualizar solo el stock

Para cambios frecuentes (cada venta, cada reposición) sin tener que mandar
el producto entero.

`PATCH /api/integraciones/productos/v1/productos/:sku/stock`

```json
{ "stock": 18 }
```

Un solo número: las unidades disponibles. Gesicom no te pide repartirlas
entre salón y depósito — eso es asunto interno de cada comercio.

`:sku` es el mismo identificador de la sección 4. Si no hay ningún
producto sincronizado con ese `sku` todavía (nunca se hizo el upsert
inicial), responde `404 PRODUCTO_NO_ENCONTRADO`.

### Response

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "stock": 18 }
```

---

## 8. Actualizar solo el precio

`PATCH /api/integraciones/productos/v1/productos/:sku/precio`

```json
{ "precio": 480000, "precio_comparacion": 550000 }
```

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "precio": 480000, "precio_comparacion": 550000 }
```

---

## 9. Dar de baja un producto

`DELETE /api/integraciones/productos/v1/productos/:sku`

Sin body.

Soft-delete: el producto queda `activo: false` y deja de mostrarse en la
tienda, pero **nunca se borra físicamente** (es la misma convención que el
resto del catálogo de Gesicomm). Si más adelante vuelve a estar disponible,
mandá de nuevo un `POST /productos` con `activo: true` (o sin el campo,
que por default es `true`).

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "activo": false }
```

---

## 10. Consultar el estado de un producto sincronizado

`GET /api/integraciones/productos/v1/productos/:sku`

Útil para auditar qué quedó cargado del lado de Gesicomm sin tener que
llevar tu propio registro.

```json
{
  "ok": true,
  "sku": "ABC-123",
  "producto_id": 4821,
  "nombre": "Zapatilla Running Pro",
  "slug": "zapatilla-running-pro",
  "precio": 480000,
  "precio_comparacion": 550000,
  "stock": 18,
  "activo": true,
  "sincronizado_en": "2026-10-09T14:05:00.000Z"
}
```

`404 PRODUCTO_NO_ENCONTRADO` si ese `sku` nunca se sincronizó.

---

## 11. Reintentos

Internet falla: tu sistema puede mandar un request, no recibir la
respuesta a tiempo (timeout) y reintentar sin saber si el primero llegó a
aplicarse. **Reintentá tranquilo.**

No hace falta que mandes ningún id de evento. El `sku` ya identifica al
producto y todas las operaciones fijan un valor absoluto —el producto
entero, `stock = N`, `precio = N`, la baja—, ninguna suma ni resta sobre
lo que había. Mandar dos veces el mismo request deja exactamente el mismo
estado que mandarlo una sola vez.

Lo único que conviene: **backoff** entre reintentos, para no comerte el
rate limit de la sección 12.

Si dos requests tuyos caen al mismo tiempo sobre un `sku` que todavía no
existe, uno de los dos puede responder `409 CONFLICTO_CONCURRENCIA`:
reintentá esa operación y queda resuelta (el producto ya va a existir y se
actualiza).

---

## 12. Límites y buenas prácticas

- **Tamaño de body**: 2 MB por request (suficiente para un lote de 200
  productos con tags e imágenes).
- **Rate limit**: 600 requests cada 15 minutos por API Key. Si lo superás,
  `429` con `codigo: "RATE_LIMIT"`.
- **Imágenes**: tienen que ser URLs públicas y estables (`https://`).
  Gesicomm no las descarga ni las re-hostea en esta versión — si tu CDN
  cambia la URL de una imagen, mandá el producto de nuevo con la URL
  nueva.
- **Reintentos**: con backoff (sección 11).
- **No hay webhooks de Gesicomm hacia ustedes** en esta versión: la
  sincronización es un solo sentido (ustedes → Gesicomm). Si necesitan
  saber el estado de un pedido, eso es otra integración (pedidos/Envio),
  no esta.

---

## 13. Qué NO cubre esta versión (a propósito, no es un bug)

- **Variantes** (talle/color). Hoy cada `sku` es un producto simple. Si tu
  catálogo tiene variantes, por ahora hay que modelarlas como productos
  separados (un `sku` por combinación).
- **Categorías jerárquicas** (`"Calzado > Running > Hombre"`): se guarda
  solo el nombre tal cual, sin armar el árbol. El comercio puede
  reorganizarlo a mano desde el panel después.
- **Re-hosteo de imágenes** en el storage propio de Gesicomm (R2): se
  linkean directo a tu URL.
- **Ofertas, combos, order bumps y paquetes** ("3 x Gs 300.000"): la ficha
  los muestra, pero se arman desde el panel del comercio. Por API entra el
  precio y el precio tachado, nada más.
- **Webhooks de vuelta** (Gesicomm avisándoles de cambios, ej. una venta
  que baja el stock desde la tienda pública). El stock que ustedes cargan
  puede quedar desactualizado si se vende por la landing de Gesicomm sin
  que ustedes lo sepan — por ahora el flujo asume que la fuente de verdad
  del stock es el sistema externo.

---

## 14. Dónde aparece un producto cargado por API

Un producto que entra por acá es un producto normal de Gesicom: no hay
"catálogo de integraciones" aparte. Una vez **aprobado** (sección 2):

1. **Mi catálogo, de todos los comercios**: cada comercio de Gesicom ve tus
   productos entre los suyos, con tu logo sobre la tarjeta y un filtro por
   proveedor para ver solo los tuyos.
2. **Sus landings y páginas de venta**: el comercio elige tus productos
   igual que cualquier otro, los agrega a su página y les pone su propio
   precio de venta.
3. **Su tienda pública**: aparece si el comercio lo publicó. Si configuró
   su tienda para vender **todos** los productos o **una categoría**
   entera, entra solo; si eligió los productos **a mano**, entra cuando el
   comercio lo agregue. Eso lo decide cada comercio, no la API.
4. **Estado de venta**: lo calcula Gesicom con lo que mandás —
   `activo: false` → no disponible; stock 0 → fuera de stock; con stock →
   en venta.

Mientras está pendiente o rechazado no aparece en ninguno de esos lugares.

Si la key es de un **comercio** (su propio ERP), lo que entra es solo de su
tienda, no pasa por revisión y ningún otro comercio lo ve.

---

## Antes de usar esto en producción

**Las dos migraciones las aplica `server.js` al arrancar**, así que se
ejecutan solas en el próximo deploy. Son idempotentes (se probó: correrlas
dos veces no cambia nada) y ninguna esconde datos existentes — todo lo que
ya está cargado queda `estado_revision = 'aprobado'`.

1. `20261009130000-create_integracion_productos.js` — crea
   `integracion_credenciales`, `integracion_productos` e
   `integracion_eventos`, suma `proveedor_id` a las credenciales y
   `logo_url` a `proveedores`. Si `integracion_eventos` ya existía con
   `event_key NOT NULL` (de la versión con deduplicación), le saca esa
   columna: sin eso ningún registro nuevo entraría.
2. `20261030210000-revision-productos-proveedor.js` — suma a `productos`
   el estado de revisión (`estado_revision`, `revision_nota`,
   `revisado_por`, `revisado_en`).

Lo único que queda a mano: **`npm run seed`**, para dejar el permiso
`gestionar_integraciones` en los roles. Solo hace falta para las keys de
comercio (su propio ERP); las de proveedor las da un administrador, que no
necesita ese permiso.

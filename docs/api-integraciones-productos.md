# API de Integraciones de Productos

Permite que un sistema externo (ERP, e-commerce propio, Shopify, etc.) de un
comercio que ya tiene Tienda en Gesicomm sincronice su catálogo de productos
automáticamente, en vez de cargarlo a mano desde el panel. Pensada desde el
día uno para que **más de un comercio** integre su propio sistema: cada uno
tiene su propia API Key y escribe únicamente en su propio catálogo.

Backend: `src/services/integracionProductos.service.js`,
`src/controllers/integracionProductosAdmin.controller.js` (gestión de keys,
con sesión) y `src/controllers/integracionProductosApi.controller.js` (la
API que usa el sistema externo), montados en `src/routes/integracionesProductosAdmin.js`
y `src/routes/integracionesProductosApi.js`. Middleware de autenticación:
`src/middleware/autenticacionIntegracion.js`.

Migración pendiente de aplicar: `migrations/20261009130000-create_integracion_productos.js`
(ver sección "Antes de usar esto en producción" al final).

---

## Cómo funciona, en una frase

El sistema externo manda (`push`) sus productos a un endpoint de Gesicomm
con su API Key. Gesicomm nunca consulta ni le pide nada al sistema externo
— toda la iniciativa es de ellos.

- **Carga inicial**: un solo request con todo el catálogo (`POST /productos/lote`).
- **Día a día**: un request por cada alta/cambio real (`POST /productos`,
  `PATCH .../stock`, `PATCH .../precio`, `DELETE /productos/:sku`).

---

## 1. Generar una API Key (panel de Gesicomm, con sesión)

Esto lo hace el COMERCIO desde su propio panel — no el sistema externo.
Requiere el permiso `gestionar_integraciones` y tener una tienda activa
seleccionada (`req.usuario.tiendaId`); si no hay ninguna seleccionada,
responde `409 { message, codigo: "TIENDA_NO_SELECCIONADA" }`, igual que el
resto de `/api/mi-tienda`.

### Crear

`POST /api/integraciones/productos/credenciales`

```json
{ "nombre": "ERP propio" }
```

```json
// 201
{
  "id": 4,
  "nombre": "ERP propio",
  "codigo": "erp-propio",
  "api_key_prefix": "gsk_7F3aQ9xZ",
  "activo": true,
  "ultima_actividad_at": null,
  "created_at": "2026-10-09T14:00:00.000Z",
  "api_key": "gsk_7F3aQ9xZmK2b...(43 caracteres más)"
}
```

⚠️ **`api_key` solo se muestra en esta respuesta.** Gesicomm guarda
únicamente su hash (SHA-256) — ni un administrador puede recuperarla
después. Si se pierde, hay que revocarla y crear una nueva.

### Listar (sin la key completa, solo el prefijo para identificarla)

`GET /api/integraciones/productos/credenciales` → array de objetos con la
misma forma que la respuesta de arriba, sin el campo `api_key`.

### Revocar

`DELETE /api/integraciones/productos/credenciales/:id` → `200` con la
credencial (`activo: false`). No se borra físicamente (queda como
auditoría). Una key revocada responde `403 INTEGRACION_INACTIVA` en la API
pública.

---

## 2. Autenticación de la API pública

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

## 3. Identificación del producto: el campo `sku`

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

## 4. Crear o actualizar un producto (upsert)

`POST /api/integraciones/productos/v1/productos`

⚠️ **Regla de "upsert parcial":** `nombre`, `precio`, `stock` y `activo`
son el estado completo del producto y se aplican siempre tal cual los
mandes. El resto de los campos (`categoria`, `marca`, `descripcion`,
`descripcion_corta`, `precio_comparacion`, `peso_kg`, `tags`, `imagenes`)
solo se tocan **si los incluís en el request**. Si creaste un producto
mandando `marca: "Nike"` y después mandás un upsert del mismo `sku` solo
para actualizar el precio (sin el campo `marca`), la marca sigue siendo
"Nike" — no se borra. Para borrar alguno de esos campos, mandalo
explícito (`"marca": null`, `"tags": []`).

### Request body

```json
{
  "event_id": "evt-2026-10-09-0001",
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
| `event_id` | Recomendado | string (≤150) | Ver sección 8 (idempotencia). Si no lo mandás, un reintento de red puede generar un duplicado lógico menor (ver nota ahí). |
| `sku` | **Sí** | string (≤100) | Su identificador. Ver sección 3. |
| `nombre` | **Sí** | string | |
| `precio` | **Sí** | número ≥ 0 | Guaraníes, **sin decimales** (ej: `450000`, no `450000.00`). |
| `stock` | **Sí**, salvo que mandes el desglose | entero ≥ 0 | Alternativa: `stock_salon` + `stock_deposito` (ver sección 6). |
| `moneda` | No | string | Si se manda, tiene que ser `"PYG"` — es lo único que se acepta hoy. |
| `descripcion` | No | string | Texto largo (HTML plano, sin tags). |
| `descripcion_corta` | No | string (≤500) | |
| `categoria` | No | string | Nombre libre. Si no existe, Gesicomm la crea. No hay jerarquía (ej. `"Calzado > Running"`) en esta versión — se guarda tal cual como una categoría plana. |
| `marca` | No | string | Igual que categoría: se busca por nombre o se crea. |
| `precio_comparacion` | No | número ≥ 0 | Precio "tachado" que se muestra como referencia de descuento. |
| `peso_kg` | No | número | Para cálculo de envío. |
| `activo` | No (default `true`) | boolean | `false` = producto dado de baja (no se borra, deja de mostrarse). |
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
  "activo": true,
  "duplicado": false
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
| `EVENT_ID_INVALIDO` | 400 | `event_id` no es string, está vacío, o supera 150 caracteres. |
| `CONFLICTO_CONCURRENCIA` | 409 | Dos requests simultáneos para el mismo `sku`/`event_id`. Reintentá. |

---

## 5. Carga inicial completa (lote)

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
  `POST /productos` de la sección 4 (sin `event_id`: no hace falta, ver
  más abajo).
- **Máximo 200 productos por request.** Si tenés más, mandá varios lotes.
- Cada producto se procesa en su propia transacción: si uno falla, los
  demás se procesan igual (no se cancela el lote entero).
- Reenviar el mismo lote dos veces es seguro: cada item es un upsert por
  su propio `sku`, así que el catálogo queda en el mismo estado (por eso
  este endpoint no pide `event_id`).

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

## 6. Actualizar solo el stock

Para cambios frecuentes (cada venta, cada reposición) sin tener que mandar
el producto entero.

`PATCH /api/integraciones/productos/v1/productos/:sku/stock`

```json
{ "event_id": "evt-stock-0001", "stock": 18 }
```

o con desglose (salón/depósito, si tu sistema lo maneja así):

```json
{ "event_id": "evt-stock-0002", "stock_salon": 12, "stock_deposito": 6 }
```

`:sku` es el mismo identificador de la sección 3. Si no hay ningún
producto sincronizado con ese `sku` todavía (nunca se hizo el upsert
inicial), responde `404 PRODUCTO_NO_ENCONTRADO`.

### Response

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "stock_salon": 12, "stock_deposito": 6, "cantidad_disponible": 18, "duplicado": false }
```

---

## 7. Actualizar solo el precio

`PATCH /api/integraciones/productos/v1/productos/:sku/precio`

```json
{ "event_id": "evt-precio-0001", "precio": 480000, "precio_comparacion": 550000 }
```

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "precio": 480000, "precio_comparacion": 550000, "duplicado": false }
```

---

## 8. Dar de baja un producto

`DELETE /api/integraciones/productos/v1/productos/:sku`

```json
{ "event_id": "evt-baja-0001" }
```

Soft-delete: el producto queda `activo: false` y deja de mostrarse en la
tienda, pero **nunca se borra físicamente** (es la misma convención que el
resto del catálogo de Gesicomm). Si más adelante vuelve a estar disponible,
mandá de nuevo un `POST /productos` con `activo: true` (o sin el campo,
que por default es `true`).

```json
{ "ok": true, "producto_id": 4821, "sku": "ABC-123", "activo": false, "duplicado": false }
```

---

## 9. Consultar el estado de un producto sincronizado

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
  "stock_salon": 12,
  "stock_deposito": 6,
  "activo": true,
  "sincronizado_en": "2026-10-09T14:05:00.000Z"
}
```

`404 PRODUCTO_NO_ENCONTRADO` si ese `sku` nunca se sincronizó.

---

## 10. Idempotencia (`event_id`) — por qué importa y cómo usarlo

Internet falla: tu sistema puede mandar un request, no recibir la
respuesta a tiempo (timeout) y reintentar, sin saber si el primero
realmente llegó a aplicarse. **Mandá un `event_id` propio y único por cada
operación** (un UUID o tu propio correlation id) en `POST /productos`,
`PATCH .../stock`, `PATCH .../precio` y `DELETE /productos/:sku`.

- Si reintentás con el **mismo** `event_id`, Gesicomm no vuelve a aplicar
  el efecto: devuelve el mismo resultado ya guardado con `"duplicado": true`.
- Si no mandás `event_id`, Gesicomm genera uno a partir de un hash del
  body — dos requests con el `sku` y los mismos valores exactos también se
  deduplican, pero si cambia aunque sea un espacio en el JSON, se trata
  como un evento distinto. **Por eso se recomienda mandar `event_id`
  explícito.**
- El endpoint de lote (`/productos/lote`) no usa `event_id`: cada item es
  un upsert por `sku`, que ya es idempotente por sí mismo (ver sección 5).

---

## 11. Límites y buenas prácticas

- **Tamaño de body**: 2 MB por request (suficiente para un lote de 200
  productos con tags e imágenes).
- **Rate limit**: 600 requests cada 15 minutos por API Key. Si lo superás,
  `429` con `codigo: "RATE_LIMIT"`.
- **Imágenes**: tienen que ser URLs públicas y estables (`https://`).
  Gesicomm no las descarga ni las re-hostea en esta versión — si tu CDN
  cambia la URL de una imagen, mandá el producto de nuevo con la URL
  nueva.
- **Reintentos**: con backoff, y siempre con el mismo `event_id` (sección
  10).
- **No hay webhooks de Gesicomm hacia ustedes** en esta versión: la
  sincronización es un solo sentido (ustedes → Gesicomm). Si necesitan
  saber el estado de un pedido, eso es otra integración (pedidos/Envio),
  no esta.

---

## 12. Qué NO cubre esta versión (a propósito, no es un bug)

- **Variantes** (talle/color). Hoy cada `sku` es un producto simple. Si tu
  catálogo tiene variantes, por ahora hay que modelarlas como productos
  separados (un `sku` por combinación).
- **Categorías jerárquicas** (`"Calzado > Running > Hombre"`): se guarda
  solo el nombre tal cual, sin armar el árbol. El comercio puede
  reorganizarlo a mano desde el panel después.
- **Re-hosteo de imágenes** en el storage propio de Gesicomm (R2): se
  linkean directo a tu URL.
- **Webhooks de vuelta** (Gesicomm avisándoles de cambios, ej. una venta
  que baja el stock desde la tienda pública). El stock que ustedes cargan
  puede quedar desactualizado si se vende por la landing de Gesicomm sin
  que ustedes lo sepan — por ahora el flujo asume que la fuente de verdad
  del stock es el sistema externo.

---

## Antes de usar esto en producción

**Falta aplicar la migración** `migrations/20261009130000-create_integracion_productos.js`
(crea `integracion_credenciales`, `integracion_productos`, `integracion_eventos`)
y correr `npm run seed` para que el permiso `gestionar_integraciones` quede
cargado en los roles. Ninguna de las dos cosas se ejecutó todavía — la base
de dev de este proyecto es la de producción por túnel SSH, así que se
necesita luz verde explícita antes de correrlas (ver memoria del proyecto:
"preguntar antes de tocar la base").

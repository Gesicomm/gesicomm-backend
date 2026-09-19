# API de Depósitos

Módulo de depósitos propios del comercio + integración con la modalidad
logística del abastecimiento Gesicomm. Backend: `src/controllers/depositoController.js`,
`src/routes/depositoRoutes.js` (montado en `/api/depositos`) y las
extensiones en `envioController.js` / `envioRoutes.js`.

Migraciones ya corridas en producción: `20260919120000-create_depositos.js`,
`20260919120100-migrar_deposito_tienda_a_depositos.js`,
`20260919120200-add_logistica_abastecimiento_envios.js`.

## Autenticación

Todas las rutas exigen sesión iniciada: cookie httpOnly `accessToken` (la
misma que usa el resto del panel). No hace falta mandar ningún header
adicional; el backend resuelve el comercio dueño de los depósitos con
`req.usuario.id` (el usuario autenticado), igual que Courier/Envio. Un
comercio nunca puede ver ni tocar depósitos de otro usuario_id.

## ⚠️ Convención de mayúsculas: pedís en camelCase, recibís en snake_case

- Los **bodies que mandás** (crear/editar) usan camelCase: `personaContacto`,
  `telefonoContacto`, `googleMapsUrl`.
- Las **respuestas** devuelven el registro tal cual está en la base
  (snake_case): `persona_contacto`, `telefono_contacto`, `google_maps_url`,
  `usuario_id`, `created_at`, `updated_at`.

No es simétrico. Es igual al resto de los módulos del backend (Courier,
Envio), pero avisamos porque en otros proyectos suele ser 1:1.

## ⚠️ Campos booleanos: mandá `true`/`false` reales, no strings

`activo` en el listado y en "cambiar estado" se compara con
`typeof x === 'boolean'`. Si mandás `"true"` (string) el filtro/validación
lo ignora o rechaza. Mandá el booleano nativo del JSON.

---

## 1. Listado paginado

`POST /api/depositos/listado`

### Request body (todos los campos opcionales salvo ninguno — `page`/`limit` tienen default)

```json
{
  "page": 1,
  "limit": 10,
  "buscar": "luque",
  "nombre": "",
  "ciudad": "",
  "departamento": "",
  "personaContacto": "",
  "activo": true
}
```

- `page` (default 1), `limit` (default 10, tope 100).
- `buscar`: búsqueda parcial (ILIKE) sobre `nombre`, `direccion`,
  `referencia`, `persona_contacto`, `telefono_contacto`.
- `nombre`, `ciudad`, `departamento`, `personaContacto`: ILIKE parcial
  individual.
- `activo`: booleano exacto. Si no se manda, trae activos e inactivos.

No existe `departamentoId`/`ciudadId` como en un spec con catálogo: en este
proyecto departamento/ciudad son texto libre (igual que Courier), así que
los filtros son por texto, no por ID.

### Response `200`

```json
{
  "data": [
    {
      "id": 1,
      "usuario_id": 3,
      "nombre": "Principal",
      "departamento": "Central",
      "ciudad": "Luque",
      "direccion": "Claudio Arrúa esquina General Artigas",
      "referencia": "Frente a la plaza",
      "persona_contacto": null,
      "telefono_contacto": "0992820631",
      "google_maps_url": null,
      "activo": true,
      "created_at": "2026-09-19T03:57:25.198Z",
      "updated_at": "2026-09-19T03:57:25.198Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

Nota: esta forma de paginado (`data/total/page/limit/totalPages`) es la
misma que usa el listado de pedidos (`envioController.listEnviosPaginados`),
para que el frontend reutilice el mismo componente de tabla/paginado.

---

## 2. Obtener uno

`GET /api/depositos/:id`

- `200` → el depósito (mismo shape que un item del listado).
- `404` → `{ "error": "Depósito no encontrado" }` si no existe o es de otro comercio.

---

## 3. Crear

`POST /api/depositos`

### Request body

```json
{
  "nombre": "Depósito Luque",
  "departamento": "Central",
  "ciudad": "Luque",
  "direccion": "Claudio Arrúa esquina General Artigas",
  "referencia": "Frente a Plaza Yvyrá Pytã",
  "personaContacto": "Juan Pérez",
  "telefonoContacto": "0992820631",
  "googleMapsUrl": "https://maps.google.com/..."
}
```

Obligatorios: `nombre`, `ciudad`, `direccion`.
Opcionales: `departamento`, `referencia`, `personaContacto`,
`telefonoContacto`, `googleMapsUrl`.

No hay `paisId` (siempre Paraguay, no se pide) ni `departamentoId`/`ciudadId`
(son texto libre, no catálogo).

- `201` → el depósito creado, con `activo: true`.
- `400` → `{ "error": "Faltan campos obligatorios: nombre, ciudad" }` (lista los que falten).

---

## 4. Editar

`PUT /api/depositos/:id`

Mismo body que crear (parcial: los campos que no mandes conservan su valor
actual — el controller mergea sobre el registro existente). No se puede
cambiar el dueño (`usuario_id` se ignora del body).

- `200` → el depósito actualizado.
- `400` → campos obligatorios faltantes tras el merge.
- `404` → no existe o es de otro comercio.

---

## 5. Activar / desactivar

`PATCH /api/depositos/:id/estado`

```json
{ "activo": false }
```

- `200` → el depósito con el nuevo estado.
- `400` → si `activo` no vino o no es booleano.
- `404` → no existe o es de otro comercio.

Un depósito inactivo no debe ofrecerse como opción en el selector de
destino de abastecimiento del frontend (el backend igual lo rechaza si se
intenta usar uno inactivo, ver sección 7).

---

## 6. Eliminar

`DELETE /api/depositos/:id`

- Si el depósito **nunca** se usó como destino de un abastecimiento →
  se borra físicamente. `200 { "success": true, "message": "Depósito eliminado correctamente" }`.
- Si **ya se usó** (existe algún `Envio.deposito_destino_id` apuntándolo) →
  no se borra: se marca `activo = false` automáticamente y se devuelve
  `200 { "success": true, "message": "...se marcó como inactivo...", "deposito": {...} }`.
  El frontend puede mostrar este mensaje tal cual para explicarle al
  usuario por qué no desapareció de la lista.
- `404` → no existe o es de otro comercio.

---

## 7. Logística de abastecimiento (integración con Pedidos/Envio)

`PUT /api/envios/:id/abastecimiento/logistica`

Se llama **antes** de confirmar el pago del abastecimiento (antes de
`POST /api/envios/:id/abastecimiento/pagopar` o de que un admin acredite la
transferencia manual). Si no se definió, el backend rechaza el pago.

### Caso GESICOMM (Gesicomm prepara y despacha)

```json
{ "tipoLogistica": "GESICOMM" }
```

No se manda `depositoId`: el frontend no conoce ni debe conocer ningún ID
de depósito propio de Gesicomm.

### Caso PROPIA (el comercio recibe en su propio depósito)

```json
{ "tipoLogistica": "PROPIA", "depositoId": 27 }
```

El backend valida que `depositoId`:
- exista,
- esté `activo: true`,
- pertenezca al comercio dueño del pedido (`usuario_id` del `Envio`).

Si algo de eso falla → `400 { "error": "El depósito indicado no existe, está inactivo o no pertenece a este comercio." }`.

Al confirmar, el backend guarda un **snapshot** de los datos del depósito
en el propio `Envio` (`deposito_destino_nombre`, `destino_departamento`,
`destino_ciudad`, `destino_direccion`, `destino_referencia`,
`destino_persona_contacto`, `destino_telefono`,
`destino_google_maps_url`), así que editar el depósito después no altera
el histórico de ese pedido.

### Reglas y errores

- `400 { "error": "tipoLogistica debe ser GESICOMM o PROPIA." }`
- `400 { "error": "La logística solo puede definirse mientras el abastecimiento está pendiente de pago." }`
  (el `Envio.abastecimiento_estado` tiene que estar en `pendiente_pago`;
  no se puede cambiar la logística una vez pagado/en proceso/recibido).
- `404` si el pedido no existe o no pertenece al comercio (salvo admin).
- `200` → el `Envio` actualizado (mismo shape que el resto de los
  endpoints de pedidos, vía `decorarEnvio`).

### Gate antes de pagar

Tanto `iniciarPagoAbastecimiento` (PagoPar) como la acreditación manual por
transferencia (`actualizarAbastecimientoManual` con
`accion: "acreditar_pago"`) rechazan la operación con:

```json
{ "error": "Definí quién prepara y despacha el abastecimiento (Gesicomm o depósito propio) antes de pagar." }
```

si `tipo_logistica_abastecimiento` sigue sin definir. El frontend debería
mostrar el paso de selección de logística/depósito como obligatorio antes
de habilitar el botón de pago, para no depender solo de este error.

---

## Pendiente (no incluido en esta entrega)

- Pantalla de listado/alta/edición de depósitos en el frontend (hoy "Mi
  Tienda → Depósito" solo edita el depósito único legacy en `tiendas.deposito_*`,
  que quedó migrado como el depósito "Principal" pero no se sincroniza
  automáticamente con la tabla nueva).
- Paso de selección de logística/depósito dentro del flujo de checkout de
  abastecimiento.
- Rediseño del pago de abastecimiento a "solo transferencia + botón marcar
  como enviado" (se mencionó pero se pidió no tocarlo todavía).
- Depósito logístico propio de Gesicomm: hoy `tipoLogistica: "GESICOMM"`
  solo registra la modalidad, sin snapshot de dirección (no existe ese
  depósito modelado en el sistema aún).

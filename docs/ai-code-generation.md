# Generación de código libre por IA — contrato RAG ↔ Node

Handoff para el proyecto RAG (Python/FastAPI). Reemplaza al `/ai/landing/draft`
actual (PageSchema V2 tipado) como motor de diseño para "Páginas de venta" →
lienzo en blanco. `PageSchema` no se elimina: sigue vivo para lo que sea
determinista (SEO, metadata, versiones) — deja de ser el motor de la parte
visual creativa, que es donde no puede expresar cosas como "más animado" o
"estilo Apple".

## Por qué este cambio

El schema tipado (`theme.palette` + `sections[].content`) no tiene ningún
campo para animaciones, layouts alternativos ni dirección de arte libre. El
conversor Node (`aiLandingSchemaToCodigo.js`) arma HTML/CSS **fijos** por tipo
de sección — así que un prompt como "hacela más animada" no tiene dónde
aterrizar: el LLM puede cambiar texto/colores, pero la estructura y el CSS
nunca varían. La solución es que el RAG devuelva HTML/CSS/JS libres, con el
mismo contrato `data-gesicomm-*` que ya usa el flujo manual (copiar a
ChatGPT/Claude, pegar la respuesta — ver `promptsCodigo.js` en el frontend),
pero automatizado.

## El contrato ya existe — reusarlo, no inventar uno nuevo

El "prompt maestro" completo (qué tags/atributos existen, cómo pintar precio,
variantes, order bump, paquetes, qué JS está prohibido, qué links de footer
son obligatorios) ya está escrito y probado en producción:

- Frontend: `gesicomm-frontend/src/pages/landing-simple/promptsCodigo.js`
  (`PROMPT_MAESTRO`, `VISTA_INICIO`, `VISTA_PRODUCTO`) — usalo tal cual como
  base del system prompt de estos dos endpoints nuevos.
- El validador de seguridad de lo que devuelva el LLM ya existe en Node:
  `LandingCodigoService.sanitizar()` (tags/atributos permitidos, denylist de
  JS) + `AICodeValidator.validar()` (allowlist de `data-gesicomm-*`, listas
  válidas, y reglas de negocio — ver más abajo). El RAG no necesita
  reimplementar nada de esto: genera código, Node lo valida.

## Endpoint 1 — `POST /ai/code/generate`

Genera un HTML/CSS/JS nuevo desde cero (reemplaza `/ai/landing/draft` para
`page_type=landing`; puede extenderse después a `home`/`product`/`category`).

**Request**
```json
{
  "page_type": "landing",
  "prompt": "Landing para el día de la madre con tonos pastel",
  "context": {
    "store": {
      "nombre": "Mi Tienda",
      "descripcion": "...",
      "whatsapp": "595981234567",
      "color_primario": "#ff69b4",
      "color_secundario": "#...",
      "logo": true
    },
    "products": [
      { "id": "producto_309", "nombre": "Vestido Primavera", "precio": 185000, "descripcion": "..." }
    ]
  }
}
```

**Response**
```json
{
  "ok": true,
  "html": "<section class=\"hero\">...</section>",
  "css": ":root { --gc-primario: #ff69b4; ... }",
  "js": "",
  "model": "grok-2-latest",
  "intentos": 1
}
```

- `html`: solo el contenido de `<body>` (sin `<html>/<head>/<body>`), igual
  que ya exige `PROMPT_MAESTRO` en su sección "Formato de tu respuesta".
- Sin `page_type` de ficha de producto todavía en la v1 — eso es el
  endpoint 1 aplicado con `page_type: "product"` (ver más abajo), no un
  tercer endpoint.

## Endpoint 2 — `POST /ai/code/edit`

Modifica el código YA EXISTENTE de una landing con una instrucción nueva.
Es la pieza que falta hoy: `crearDesdeIA`/`regenerarConIA` en Node llaman
ambos al mismo generador de "desde cero", así que "hacela más animada"
reescribe todo en vez de ajustar lo que ya había.

**Request**
```json
{
  "instruction": "Hacela más animada y llamativa",
  "current": {
    "html": "...",
    "css": "...",
    "js": ""
  },
  "context": {
    "store": { "...": "..." },
    "products": [ "...": "..." ]
  }
}
```

**Response**: mismo shape que `/ai/code/generate`.

**System prompt clave** (además del `PROMPT_MAESTRO` base): *"Conservá el
contenido, los componentes comerciales (`data-gesicomm-*`) y el
comportamiento existente salvo que la instrucción pida explícitamente
cambiarlos. Modificá principalmente la capa visual: CSS, layout, animaciones,
tipografía. No inventes productos nuevos ni cambies los que ya estaban."*

## Endpoint 3 — `POST /ai/code/repair` — YA IMPLEMENTADO

Cuando Node valida el HTML devuelto y encuentra errores (`AICodeValidator`),
le pide al RAG que corrija SOLO esos errores puntuales, en vez de regenerar
todo:

```json
{
  "current": { "html": "...", "css": "...", "js": "" },
  "errores": [
    "El atributo \"data-gesicomm-super-checkout\" no existe en Gesicomm.",
    "La página muestra productos pero no tiene ningún botón de compra."
  ],
  "page_type": "landing",
  "context": { "store": { "...": "..." }, "products": [ "...": "..." ] }
}
```

Implementado en `app/routers/ai_code.py` / `app/services/code_ai_service.py`
(`repair()`, temperatura 0.2 — es corregir, no diseñar). Node limita esto a
**1 repair como máximo** (nunca un loop) — ver
`AILandingService._conRepairAutomatico` en `aiLanding.service.js`: pide el
primer intento, valida con `validarTodo()` (sanitizador + sintaxis JS +
preservación + CommerceCodeValidator), y si falla pide UN repair y valida
de nuevo antes de tirar el error final.

## Ficha de producto — mismo pipeline, no un motor aparte

```json
{
  "page_type": "product",
  "prompt": "Quiero una ficha tecnológica premium, oscura y muy visual",
  "context": {
    "product": {
      "id": "producto_310",
      "nombre": "...",
      "ficha_rubro": "TECH",
      "ficha_datos": { "...": "..." },
      "propuesta_valor": "...",
      "beneficios": [{ "titulo": "...", "texto": "..." }]
    }
  }
}
```

`VISTA_PRODUCTO` en `promptsCodigo.js` ya documenta la estructura que más
convierte (orden de secciones, qué va arriba del pliegue, binds de precio/
variantes/paquetes/order bump). Los templates rígidos (`BeautyProductPage.jsx`,
`FitnessProductPage.jsx`, `TechProductPage.jsx`) sirven como **few-shot**, no
como renderer: mostrarle al RAG un resumen de qué estructura funciona bien
por rubro (galería protagonista + specs técnicas para TECH, tono/tacto para
BEAUTY, etc.), aclarando explícitamente que no tiene que copiar la
estructura, solo inspirarse en la jerarquía y calidad.

## Del lado Node (Gesicomm backend) — ya construido

- `/ai/code/generate` y `/ai/code/edit` **ya están implementados** en el RAG
  (`app/routers/ai_code.py`, `app/services/code_ai_service.py`) y Node ya los
  consume desde `AILandingService.crearDesdeIA`/`regenerarConIA` — con
  fallback automático a `construirCodigoDesdeSchema()` (PageSchema) solo si
  el RAG responde 404 (todavía no redeployado).
- `AICodeValidator` (`src/services/aiCodeValidator.service.js`):
  - `validar()`: allowlist de atributos `data-gesicomm-*` y de valores de
    `data-gesicomm-lista` (rechaza), allowlist de `data-gesicomm-bind`
    (advierte, no rechaza — el runtime acepta cualquier campo como
    fallback), producto pertenece a la selección de la landing, y "si
    muestra productos tiene que haber una acción de compra".
  - `validarPreservacion(anterior, nuevo, instruccion)`: la validación de
    negocio que faltaba para `/ai/code/edit` — compara el HTML antes/después
    de un edit y RECHAZA (antes de guardar) si perdió demasiados
    `data-gesicomm-*`, se quedó sin ninguna acción de compra, o el HTML se
    achicó demasiado — salvo que la instrucción pida explícitamente un
    rehecho total ("rehacé todo", "desde cero", etc.). No es un diff real,
    son 3 reglas simples (conteos, no AST) — alcanza para el caso típico
    ("agregá una sección" no debería volver con 70% menos HTML).
- `LandingCodigoService.sanitizar()` + `revisarSintaxisJs()`: la capa de
  seguridad (ya existía, usada hoy con código pegado a mano) — se le sumó
  una verificación de que el JS al menos PARSEE (`new Function()` sin
  ejecutar) antes de guardar, después de que un código generado por IA
  quedó guardado con una variable declarada dos veces y rompió el runtime
  en producción.
- **Target de edición conectado** (`target: "inicio"|"producto"|"producto_especifico"`
  en `POST /:id/ai-regenerar`, mapea a `page_type: "landing"|"product"` en
  `/ai/code/edit`): el Asistente IA del editor edita la vista en la que
  está parado el usuario — Inicio, ficha general, o la ficha PROPIA de un
  producto puntual (`content.vistas.productos[contentId]`, con
  `context.product` = datos reales del producto — `AILandingService.
  resolverProductoPorContentId`). Esto es lo que permite que cada producto
  tenga un diseño de ficha distinto ("este termo estilo outdoor", "este
  auricular tech futurista") sin compartir código con la ficha general ni
  con otros productos.
- **Repair loop automático**: ver Endpoint 3 arriba.
- **Telemetría** (`ai_generation_logs`, migración `20260925184200-create-ai-generation-logs.js`
  + modelo `AiGenerationLog`): una fila por cada `crearDesdeIA`/`regenerarConIA`
  — prompt, page_type, target, content_id, modelo, latencia_ms, tokens_input/
  output, repair_used, exitoso, validation_errors (post-repair) y
  validation_errors_pre_repair. `AiGenerationLogService.registrar()` nunca
  rompe el flujo principal si guardar el log falla. `/ai/code/generate|edit|
  repair` devuelven `tokens_input`/`tokens_output` (desglosados, no solo el
  total) para esto — si se agregan más providers/endpoints del lado RAG,
  mantener esos dos campos en la respuesta.

## Pendiente / decisiones para quien construya el lado RAG

- [ ] Definir el modelo/versión por defecto y cómo se parametriza (hoy
      `LLM_PROVIDER=grok|openai` en `RAG/.env`, según la doc de arquitectura
      previa).
- [ ] Definir el máximo de tokens de salida (un HTML+CSS completo de landing
      puede ser largo — `LandingCodigoService.sanitizar()` ya tiene límites
      de 200KB HTML / 100KB CSS / 50KB JS, opciones más altas para Page
      Builder — decidir si "lienzo en blanco IA" usa los límites normales o
      los ampliados).
- [ ] Decidir si `/ai/code/edit` recibe el HTML/CSS/JS completos cada vez
      (más simple, más tokens) o un diff/patch (más barato, más complejo de
      validar).
- [ ] Timeout: Node hoy corta a los 35s (`solicitarBorradorRAG`) — un
      código libre más largo puede necesitar más tiempo; ajustar ambos lados
      a la vez.

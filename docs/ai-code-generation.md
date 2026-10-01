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

## Urgencia (countdown) y prueba social (estadísticas): modo demo → real

La IA puede generar countdown de oferta y estadísticas cuantitativas ("94% se sintió más
liviano") — son patrones de alta conversión, especialmente en suplementos. Pero nunca como
texto/fecha fija en el HTML: eso sería publicidad engañosa real (Meta Ads y la Ley 1334 de
Paraguay prohíben ambas cosas explícitamente). La resolución es un modo demo→real:

1. El HTML SOLO declara la estructura (`data-gesicomm-countdown` con sus
   `data-gesicomm-countdown-parte="horas|minutos|segundos"`, y
   `data-gesicomm-lista="estadisticas"` con binds `valor`/`etiqueta`) — nunca calcula fechas ni
   escribe cifras. El runtime (`runtimeGesicomm.js`, `prepararCountdowns()`/`fuenteDeLista()`)
   es quien pinta los valores reales en vivo, leyendo `venta.urgencia`/`venta.prueba_social`.
2. El RAG puede proponer que la composición use esos bloques vía `demo_data` en su respuesta
   (`{"urgencia": {"activo": true, "preset": "24h"|"48h"|"72h"}, "prueba_social": {"items": [...]}}`)
   — nunca calcula la fecha real, solo la intensidad; Node resuelve "ahora + preset".
3. Node (`AILandingService.fusionarDemoData`) solo LLENA HUECOS: si la landing ya tiene
   cualquier config para ese bloque (confirmada o no), la IA nunca la pisa al regenerar.
4. Todo lo que entra por `demo_data` o por el panel "Configurar venta" queda en
   `estado: 'demo'` — `LandingCodigoService.limpiarVenta()` lo fuerza siempre así. La ÚNICA
   puerta hacia `estado: 'confirmado'` es un campo separado `confirmaciones` en el PUT (nunca
   dentro de `venta`), que el backend solo acepta si el bloque ya está completo
   (`activo && fin_at`, o `activo && items.length`).
5. `AICodeValidator.detectarBloquesSinConfirmar()` bloquea `cambiarEstado(activo=true)`
   (publicar) si el HTML usa esas primitivas y el bloque correspondiente no está
   `activo + completo + estado:'confirmado'` — sin importar si venció la fecha (eso es
   comportamiento normal de runtime, no un motivo de bloqueo).

`estado` es un string (`'demo' | 'confirmado'`), no un boolean, a propósito: deja espacio para
sumar `'importado'`/`'verificado'`/`'incompleto'` el día que haga falta, sin migrar nada.

## Estructura concreta por rubro (`product_family`)

`planLandingIA()` (Node) clasifica el producto con `inferirFamiliaProducto()`
y manda el resultado en `context.commerce.landing_plan.product_family`
(`suplementos | electrodomesticos | bazar_hogar | tecnologia | belleza | moda
| general`). Hasta acá esa familia solo entraba al RAG como una lista de
secciones sugeridas ("guía comercial, no un layout rígido"), sin ningún
detalle de CÓMO armar esas secciones — en la práctica, dos productos de
rubros distintos podían terminar con la misma landing genérica de "hero +
grilla" porque el LLM no tenía un patrón concreto que seguir por rubro.

Del lado RAG (`app/services/code_ai_service.py`) ahora existe
`INSTRUCCIONES_FAMILIA`: un diccionario `product_family → bloque de texto`
con la estructura concreta que convierte mejor para ese rubro (qué secciones,
en qué orden, con qué `data-gesicomm-*` de datos reales), inyectado en el
system prompt SOLO cuando `product_family` coincide con una clave del
diccionario (`_familia_desde_contexto()` + `_system_prompt(page_type,
product_family)`). Si la familia no tiene entrada, no se agrega nada y el
modelo sigue con la libertad total de `INSTRUCCIONES_LANDING`/`PRODUCTO` — así
un producto de un rubro sin estructura definida (o mal clasificado) nunca
hereda por accidente la estructura de otro rubro.

Implementado: `suplementos` (venta directa: hero con galería +
comparador de packs, franja de confianza sin urgencia falsa, cómo funciona/
modo de uso, ingredientes/fórmula desde `ficha_datos`, prueba social solo si
es real, antes/después solo con imagen real, diferenciales reales en vez de
comparación contra competidores inventados, FAQ) y `tecnologia`/
`electrodomesticos` (mismo texto para ambos: ficha técnica de specs REALES
desde `ficha_datos` sin versión "de ejemplo" — a diferencia de las
estadísticas de marketing, una especificación técnica inventada es un dato
falso, no un placeholder —, comparativa contra "modelos básicos" genéricos
nunca marcas inventadas, y reseñas con nombre de persona prohibidas sin
excepción salvo que sean reales), `belleza` (mismo patrón que suplementos
pero tono editorial/sensorial: rutina de pasos, ingredientes/activos,
antes/después solo con imagen real, calificación con conteo de reseñas vía
demo→real, reseñas con nombre solo si son reales) y `bazar_hogar` (principio
central: "no vendas el objeto, vendé cómo queda el espacio" — prioriza
ambientación/contexto de uso con imágenes reales, y para el selector de
compra prioriza `paquetes` reales del comercio sobre un selector genérico de
cantidad — cantidad libre queda como fallback solo si no hay paquetes
cargados; medidas y materiales solo si vienen de `ficha_datos`) y `moda`
(talle SIEMPRE como variante, nunca como paquete ni cantidad; guía de
talles/tabla de medidas es el dato de mayor sensibilidad de todos los
rubros — una medida inventada hace que compren el talle equivocado — así
que tiene tolerancia CERO: sin `ficha_datos` ni brief con medidas reales,
la tabla se omite completa, sin excepción). Las cinco entradas implementadas
(`suplementos`, `tecnologia`/`electrodomesticos`, `belleza`, `bazar_hogar`,
`moda`) — que cubren todos los valores que devuelve `inferirFamiliaProducto()`
salvo `general` — ya usan BRIEF_COMERCIAL_DEL_COMERCIANTE como respaldo antes
de omitir una sección: el wizard le pregunta al comercio los datos que falten
ANTES de generar (ver AILandingWizard → construirPreguntasBrief), así que
"omitir" es el último recurso, no el default.

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

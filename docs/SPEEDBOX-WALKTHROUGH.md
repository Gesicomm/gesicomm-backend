# Speedbox: walkthrough y plan completo de pruebas

Fecha: 02/10/2026. Ultima actualizacion: **24 escenarios E2E aprobados**,
**106 tests backend + 9 tests frontend aprobados**, build frontend aprobado.
La seccion 9 describe el envio al confirmar y el registro externo. Las
secciones anteriores conservan la evidencia historica de la primera corrida
de 21 escenarios y 85 tests backend + 7 frontend.
Esto NO certifica el sandbox externo ni habilita produccion en Speedbox.

## 1. Aislamiento del trabajo

Backend y frontend viven en repositorios separados. Ambos tienen la rama
`codex/speedbox-integration`, en estos worktrees:

| Parte | Directorio | Commit de implementacion |
| --- | --- | --- |
| Backend | C:\Proyectos\Gesicom\speedbox-backend | eb365b1 |
| Frontend | C:\Proyectos\Gesicom\speedbox-frontend | 86fb16e |

No se cambiaron las ramas de los checkouts originales ni se mezclaron sus
desarrollos. No se importaron lotes, ni se editaron SKU o stock de la base
existente. El propietario confirmo que los SKU coinciden con Speedbox.

Esta segunda etapa agrega el runner E2E, su comando npm y documentacion.
No altera el cliente Speedbox para permitir HTTP inseguro en produccion.

## 2. Que se implemento

### Backend

1. Cliente HTTP privado: `src/services/speedbox/client.js`. Lee Key/Secret
   del entorno, usa Bearer + X-API-Secret, valida payloads y respuestas,
   conserva IDs como texto y distingue errores definitivos de ambiguos.
2. Armado de pedido: `payload.js`. Usa los componentes fisicos confirmados
   del pedido, SKU de producto/variante, cliente, direccion, tienda, moneda
   PYG y total a cobrar. No importa catalogo ni stock externo: la API
   proporcionada no documenta esos endpoints.
3. Orquestacion: `service.js`. Prueba spec, vincula tienda, selecciona
   courier, guarda configuracion, envia pedidos y ejecuta el barrido
   automatico. Serializa operaciones con transacciones y locks PostgreSQL.
4. Persistencia: migracion `20261002150000-speedbox-integration.js` y modelos
   `SpeedboxTienda`, `SpeedboxPedido`, `SpeedboxEvento`. Guardan vinculacion,
   IDs, payload/respuesta, intentos, cursor, eventos y resultados.
5. Eventos: `events.js`. Recibe webhook o updates, deduplica, aplica estados
   y movimientos de stock, registra historial y reprocesa IDs no vinculados.
6. Rutas privadas: `/api/integraciones/speedbox`. Usan identidad de la sesion,
   no un usuario suministrado en el body. El webhook publico se protege con
   token propio y ambiente en `/api/webhooks/speedbox`.
7. Job cada minuto: `src/services/cron/speedbox.job.js`. Solo toma pedidos
   confirmados con stock reservado, courier elegido, integracion activa y
   fecha posterior a activacion. El envio externo no bloquea el checkout.
8. Proteccion de inventario: el controller de pedidos impide cancelar,
   reasignar courier o borrar un pedido enviado/ambiguo sin conciliacion.

### Frontend

En Mi tienda se agrega la pestana Speedbox, implementada en
`src/pages/tienda/SpeedboxConfig.jsx`, `speedbox.css` y su servicio HTTP.
Incluye conexion, vincular tienda, courier, activacion, checks, envio manual,
sincronizacion, pedidos, errores/reintentos, revisiones y movimientos de
billetera. No recibe ni guarda credenciales privadas del proveedor.

Un reintento ambiguo abre un dialogo que exige confirmar que se busco el ID
externo en Speedbox y el pedido no existe. Mantiene el payload y el ID externo
originales; no se presume idempotencia del proveedor.

### Recorrido

```text
Pedido confirmado en Gesicomm -> stock reservado y snapshot fisico
    -> courier Speedbox -> envio manual o job
    -> POST order -> relacion external_order_id / order_id persistida

Webhook o GET updates -> evento durable y deduplicado
    -> pedido local -> estado + stock + historial
    -> siguiente cursor solo si la pagina completa se proceso

Billetera -> movimientos observados separados de liquidaciones locales
Devolucion -> revision -> inspeccion fisica -> devolucion por componente
```

## 3. Como se ejecuto el E2E

El runner `test-speedbox/run.cjs` crea PostgreSQL independiente, arranca el
frontend real y un app Express con routers/controllers/services de produccion.
Speedbox es un servidor HTTP local con credenciales ficticias, no respuestas
mockeadas en el navegador. El cliente de produccion construye sus llamadas
normalmente; solo el transporte hacia Speedbox se redirige en este proceso.

El login y el alta de pedidos usan HTTP contra endpoints reales. El navegador
opera configuracion, envio, sincronizacion y reintentos. Cada assertion de
stock lee las filas PostgreSQL, no un estado React ni un objeto simulado.

La corrida final duro aproximadamente 17 segundos, de 17:16:45 a 17:17:02
hora de Asuncion. Creo 110 tablas base y ejecuto la migracion Speedbox real
dos veces. Uso una base nueva `gesicomm_speedbox_e2e_1762fd4b` en
127.0.0.1:53073. Al terminar cerro navegador, Vite, API, simulador y PostgreSQL;
`cleanup_errors` quedo vacio. No quedan esos servicios de prueba escuchando.

Hubo dos corridas completas previas de 20 escenarios aprobados. La ultima
agrego el caso de billetera sin event_id del ejemplo recibido.

El bootstrap no arranca server.js ni reproduce todas las migraciones
historicas del sistema. Las tablas base se crean desde modelos; se omiten
solo comentarios DDL temporalmente por un problema de Sequelize con ENUM y
FK ciclicas. La migracion Speedbox no se modifica. El sidebar educativo
recibe una respuesta vacia de soporte. Se invoca runCycle() directamente,
sin esperar el tick real del cron. Ver detalle en `test-speedbox/README.md`.

## 4. Pasos y resultados de los 21 escenarios

Todos los pasos siguientes se ejecutaron, no son solo una propuesta.

| Paso | Accion de prueba | Resultado observado |
| --- | --- | --- |
| 01 | Crear cluster y base nuevos en puerto libre | PostgreSQL real, sin reutilizar DB_* existentes |
| 02 | Crear esquema, aplicar migracion Speedbox dos veces | 110 tablas; segunda aplicacion sin error |
| 03 | Login real y abrir Mi tienda > Speedbox | JWT valido, cookie HttpOnly y panel visible |
| 04 | Probar conexion, vincular, elegir courier y activar desde UI | tienda_id 54; repetir vinculacion no crea otra tienda; Secret ausente del JSON |
| 05 | Crear pedido confirmado por API y enviarlo desde UI | 85000 PYG, SKU-001, ID 900000000123456; stock 100 -> 99 disponible y 1 reservado |
| 06 | Volver a enviar ese mismo pedido | Devuelve vinculacion existente; una sola llamada order remota |
| 07 | Webhook con token invalido y luego estado invalido | HTTP 401 y 400; cero eventos persistidos |
| 08 | Webhook cargado | Preparado; reserva sigue en 1 |
| 09 | Enviar simultaneamente tres webhooks en_camino con el mismo event_id | Una fila de evento; Despachado; reservado 0, transito 1 |
| 10 | Consultar novedades desde UI con entrega y credito 85000 | Entregado; transito 0; billetera registrada; cursor guardado; cuatro checks locales verdes |
| 11 | Repetir pagina updates y enviar cargado antiguo | Una fila del credito; estado terminal no retrocede; evento antiguo ignorado |
| 12 | Cancelar, cambiar courier y borrar pedido remitido | Cancelacion/courier 409; borrado usuario 403; borrado admin 409; pedido y reserva intactos |
| 13 | Autenticar otra tienda y consultar/enviar pedido ajeno | Cero pedidos/eventos visibles; envio rechazado con 409 por falta de vinculacion propia |
| 14 | Crear confirmado Speedbox, confirmado otro courier y Pendiente; ejecutar runCycle | Solo el confirmado Speedbox se envia |
| 15 | Inyectar HTTP 500 y reintentar sin/con confirmacion desde UI | Incierto; sin confirmacion 409; dialogo bloqueado hasta checkbox; segundo intento conserva payload e ID y queda enviado |
| 16 | Devuelto sin aviso previo de despacho; luego inspeccion vendible real | No repone stock al recibir webhook; pasa reserva a transito; inspeccion repone una unidad; repetir inspeccion 400 sin duplicar stock |
| 17 | Updates con debito valido y evento invalido; corregir y repetir | No avanza cursor de pagina fallida; debito ya guardado no se duplica; cursor avanza al completar replay |
| 18 | Quitar SKU al producto ficticio e intentar enviar; corregir y reintentar | HTTP 422 sin llamada remota; error queda durable; retry con SKU corregido queda enviado |
| 19 | Webhook en_camino antes de conocer el order_id | Evento pendiente durable; despues de vincular y reprocesar queda procesado y Despachado |
| 20 | Consultar dos veces el ejemplo wallet sin event_id | Una observacion hash en revision; no acredita saldo ni liquida el pedido |
| 21 | Recargar panel en desktop y mobile | Configuracion persistida, sin overflow de pagina ni errores JS no capturados; capturas generadas |

La corrida crea 9 pedidos ficticios, 7 relaciones con IDs remotos y 9 eventos.
Hay 17 llamadas HTTP al simulador. El stock final es 93 disponible, 5 reservado
y 1 en transito: algunas pruebas dejan pedidos abiertos deliberadamente.
Una unidad entregada ya no pertenece al inventario. No se espera recuperar
100 disponibles al finalizar.

## 5. Evidencias

Carpeta final: `C:\Proyectos\Gesicom\tmp\speedbox-e2e-1790972205689`.

- `report.json`: resultado por escenario, duracion, payloads, cursores,
  pedidos, eventos, stock, llamadas al simulador y limpieza de recursos.
- `desktop.png`, `mobile.png`: configuracion y conexion persistidas.
- `desktop-orders.png`, `mobile-orders.png`: pedidos e IDs.
- `desktop-wallet.png`, `mobile-wallet.png`: movimientos de billetera.
- `retry-desktop.png`: confirmacion obligatoria de reintento ambiguo.
- `postgres.log`, `postgres-commands.log`, `vite.log`: arranque y diagnosticos.

Las capturas se inspeccionaron visualmente. En mobile la tabla tiene scroll
horizontal interno, sin expandir la pagina. Las cuatro marcas verdes de esas
capturas son SOLO de esta prueba local, no del portal Speedbox.

## 6. Repetir la prueba automaticamente

Desde PowerShell, con dependencias de ambas ramas y Chromium disponibles:

```powershell
Set-Location C:\Proyectos\Gesicom\speedbox-backend
npm run test:speedbox:e2e
```

No configurar credenciales reales para este comando. El runner siempre usa
credenciales ficticias y una base nueva. Si Windows/Codex bloquea el arranque
de PostgreSQL, ejecutar con el permiso para ese proceso local; no apuntar el
runner a una base existente como alternativa.

Los requisitos y variables opcionales estan en `test-speedbox/README.md`.
No ejecutar la suite generica test:integration contra el puerto 5434: el repo
advierte que ese puerto puede corresponder al tunel de PRODUCCION.

Regresion ejecutada nuevamente en esta etapa:

```powershell
Set-Location C:\Proyectos\Gesicom\speedbox-backend
npx jest src/tests/services/speedboxClient.test.js src/tests/services/speedboxEvents.test.js src/tests/services/speedboxService.test.js src/tests/services/speedboxMigration.test.js src/tests/speedboxWebhook.test.js src/tests/courier.test.js src/tests/asyncHandler.test.js --runInBand --detectOpenHandles
Set-Location C:\Proyectos\Gesicom\speedbox-frontend
npx vitest run src/pages/tienda/SpeedboxConfig.test.jsx src/pages/tienda/ConfigurarTienda.test.jsx
npm run build
```

Jest: 85/85. Vitest: 7/7. Build: aprobado, con el warning existente de chunks
mayores a 500 kB. Las dos pruebas Playwright anteriores con API mockeada no
se volvieron a contar como E2E real ni se suman a estos 21 escenarios.

## 7. Prueba manual contra Speedbox real

Estado: NO EJECUTADA, faltan credenciales privadas y un entorno HTTPS de prueba.
La documentacion de conexion recibida es sandbox. No usar datos de clientes
reales ni activar esta rama en produccion para hacer la validacion.

1. Preparar backend y frontend de esta rama en staging, con una base de
   pruebas vacia independiente y permisos/migraciones del sistema. Verificar
   DB_HOST, DB_PORT y DB_NAME antes de arrancar server.js. No copiar el .env
   de produccion. Confirmar que no apunta al tunel 5434 ni a la base activa.
2. Guardar privadamente SPEEDBOX_API_KEY y SPEEDBOX_API_SECRET en el backend;
   usar SPEEDBOX_ENVIRONMENT=sandbox y el endpoint documentado. Generar
   SPEEDBOX_WEBHOOK_TOKEN aleatorio de al menos 32 caracteres. Mantener
   SPEEDBOX_ENABLED=false para comenzar sin envios automaticos.
3. Configurar VITE_API_URL con el backend staging y CORS/cookies para el
   dominio de prueba. Iniciar backend y frontend; confirmar sesion normal,
   permisos de tienda y que se aplico la migracion Speedbox.
4. Entrar en Mi tienda > Speedbox y usar Probar conexion. Esperar HTTP 200,
   ok:true y check de Autenticacion. Si devuelve 401 revisar credenciales;
   403 exige confirmar habilitacion y vinculacion con el proveedor.
5. Usar Vincular tienda una vez. Anotar tienda_id real. Verificar la forma
   exacta de la respuesta store, no solo el ejemplo del simulador. Repetir
   la accion debe conservar esa vinculacion.
6. Crear/seleccionar courier Speedbox para el comercio, activar y Guardar.
   Confirmar que un usuario de otra tienda no puede seleccionar ese courier.
7. Crear un producto de prueba con SKU que exista en Speedbox. Usar stock
   ficticio y registrar disponible/reservado/transito antes del pedido.
   No usar SKU-001 del runner salvo que el proveedor realmente lo reconozca.
8. Crear pedido de prueba con cliente, telefono, direccion, referencia,
   ciudad, departamento, mapa y metodo de pago. Asignar courier Speedbox y
   confirmar: comprobar reserva y snapshot de componentes.
9. Elegirlo en Pedido confirmado > Enviar pedido. Esperar respuesta HTTP 201
   de Speedbox, ID interno como texto y estado pendiente_confirmacion.
   Buscar el mismo external_order_id en el portal y comparar SKU, cantidades,
   precios, PYG, tienda y direccion. Debe existir exactamente un pedido.
10. Volver a enviar el pedido desde la API o panel cuando corresponda.
    Debe devolver la relacion guardada sin crear otro pedido remoto.
11. Usar Consultar novedades. Anotar since_at enviado y next_since_at
    devuelto, comparar eventos con el portal y repetir la consulta. Los
    movimientos no deben duplicarse ni liquidar dinero local por inferencia.
12. Registrar en Speedbox la URL HTTPS completa del receptor:
    https://<api-staging>/api/webhooks/speedbox?environment=sandbox&token=<privado>.
    Verificar que el portal preserva los parametros o permite un header
    privado equivalente. Excluir query strings sensibles de logs del proxy.
13. Solicitar/generar un cambio de estado de prueba en Speedbox. Comprobar
    POST del proveedor, HTTP 200 del receptor, event_id guardado, pedido
    localizado por order_id y check Webhook verificado. Un POST manual con
    curl NO reemplaza la prueba enviada por el proveedor.
14. Recorrer cargado -> en_camino -> entregado. Comparar estado e inventario
    tras cada evento con la tabla de la seccion 4. Reenviar el mismo evento
    desde el portal si permite hacerlo; no debe duplicar historial o stock.
15. Crear otro pedido para devolucion. El aviso devuelto no debe reponer
    stock. Inspeccionar y usar la devolucion por componente existente, con
    cantidad y condicion real. Verificar que repetirla no vuelve a reponer.
16. En staging, probar un webhook sin token y con ambiente equivocado:
    esperar 401 y 409. No desproteger el receptor para obtener el check.
17. Validar envio automatico: SPEEDBOX_ENABLED=true requiere reiniciar el
    backend. Confirmar un pedido despues de activar: debe enviarse tras el
    commit, sin esperar el tick de un minuto. Confirmar una sola creacion remota y exclusion de Pendiente
    y otros couriers. Probar un pedido antiguo solo con envio manual.
18. Ante un error ambiguo real, detenerse y buscar external_order_id en el
    portal. Solo autorizar retry si no existe. Si existe y se perdio el ID,
    conciliar con Speedbox: esta API no documenta consulta por ID externo.
19. Registrar evidencia real de las cuatro pruebas en el portal: spec,
    pedido, updates/billetera y webhook del proveedor. Solo entonces pedir
    habilitacion de produccion. No asumir el endpoint productivo ni reutilizar
    IDs, cursores o token del sandbox.

## 8. Limites y observaciones para analizar

Esta seccion describe la corrida original. La ampliacion de abastecimiento,
inventario y conciliacion se documenta en la seccion 10; resuelve las
observaciones originales de variantes, cierre de devoluciones y defaults.

- No se probo Speedbox real, TLS del receptor, proxy/hosting, forma real de
  store, preservacion del token por el portal ni sus cuatro checks oficiales.
- No se automatizo la UI del checkout publico ni la carga de lotes. El alta
  probada utiliza el controller real de pedidos manuales. La API recibida
  no permite comprobar disponibilidad del proveedor o importar su catalogo.
- El E2E usa producto simple propio del comercio. Combos y variantes tienen
  pruebas unitarias de payload, no un recorrido completo de compra con
  abastecimiento Gesicomm y centros de fulfillment en esta corrida.
- La prueba de aislamiento usa otro usuario sin tienda Speedbox vinculada:
  valida ocultacion y rechazo, pero no dos tiendas activas con trafico simultaneo.
- El estado de revision del evento de devolucion sigue visible despues de
  completar la inspeccion por el flujo existente. El stock queda correcto,
  pero falta cerrar/reconciliar esa revision en el panel. No hay boton de
  resolucion de revisiones implementado actualmente.
- Sequelize avisa que data/hasId no pertenecen al modelo al usar defaults
  de findOrCreate. No impidio persistir ni procesar eventos en estas pruebas;
  es ruido de diagnostico, no evidencia de fallo de stock.
- Las observaciones wallet sin event_id se muestran en revision y no deben
  usarse como libro contable ni saldo: dos transacciones identicas sin ID
  pueden ser indistinguibles. La pagina registra movimientos, no una
  conciliacion financiera final ni liquidaciones de Speedbox.

Conclusion: los escenarios locales ejecutados estan aprobados y son
repetibles. La integracion externa y el despliegue permanecen pendientes de
la prueba real descrita arriba; no se afirma que este habilitada para produccion.

## 9. Regla acordada: envio al confirmar y acceso al registro

El propietario indico que el pedido debe enviarse al confirmarlo. El envio
NO depende de finalizar el abastecimiento. Implementacion actualizada en la
misma rama aislada, sin cambiar los estados de abastecimiento ni las reglas
de recepcion fisica de inventario.

Con SPEEDBOX_ENABLED=true, tienda vinculada/activa y courier Speedbox:

1. Crear un pedido ya Confirmado, confirmar uno Pendiente o confirmar un
   pago guarda SpeedboxPedido.pendiente dentro de la misma transaccion.
2. El callback afterCommit agenda la llamada inmediatamente, fuera de la
   transaccion y sin bloquear la respuesta del checkout.
3. Si se revierte la confirmacion tambien desaparece el registro pendiente;
   nunca se envia un pedido cuya confirmacion no se guardo.
4. Si se interrumpe el proceso despues del commit, el barrido de recuperacion
   toma los pendientes, incluso si el pedido se creo antes de activar.
5. Un error remoto no desconfirma la venta. Timeout/HTTP 5xx siguen dejando
   un resultado incierto que requiere conciliacion manual, sin retry ciego.
6. Si se asigna Speedbox a un pedido ya Confirmado, el mismo hook lo agenda
   cuando cumple las condiciones. Otros couriers siguen excluidos.

Se agrego **Cuenta en Speedy > Crear cuenta en Speedy** en el panel.
`SPEEDBOX_REGISTRATION_URL` permite configurar el enlace publico oficial.
Abre otra pestana sin enviar datos personales, tokens ni cookies de Gesicom.
Sin enlace oficial queda deshabilitado. Sigue pendiente que el propietario
provea esa URL y confirme si Speedy es el mismo sistema Speedbox. El enlace
de ejemplo usado por los tests NO es una URL de registro real.

La documentacion recibida no incluye una API de alta de usuarios ni SSO;
por eso no se implemento un formulario que cree cuentas externas. Registrarse
en el portal tampoco vincula automaticamente esa identidad con la tienda que
crea la API: esa vinculacion debe verificarse con el proveedor.

### Verificacion nueva

Corrida cerrada: `C:\Proyectos\Gesicom\tmp\speedbox-e2e-1790978934783\report.json`,
02/10/2026 de 19:08:54 a 19:09:13 hora de Asuncion. Los 24 escenarios pasaron
y cleanup_errors quedo vacio. Conserva las capturas desktop/mobile actualizadas.

Ademas de los 20 escenarios operativos anteriores, se verificaron:

| Paso actual | Verificacion | Resultado |
| --- | --- | --- |
| 03 | Enlace de registro desde API real a panel real | href HTTPS ficticio exacto, sin datos personales |
| 21 | Pedido Pendiente antiguo se confirma con abastecimiento pendiente_pago | Envio inmediato, una sola llamada order, abastecimiento sigue pendiente_pago |
| 22 | Rollback de cola y recuperacion despues de commit sin dispatch | Rollback: cero filas y llamadas; recuperacion: enviado aunque created_at sea antiguo |
| 23 | Alta Confirmado y HTTP 500 inmediato del proveedor | Alta responde 201, reserva permanece, Speedbox incierto |
| 24 | Desktop/mobile con apartado Cuenta en Speedy | Capturas, estado persistido y sin errores JS no capturados |

Pruebas focalizadas: 106/106 backend (ocho suites), 9/9 frontend (dos suites),
build aprobado. El enlace sin configurar, HTTPS inseguro, URLs con credenciales
y confirmacion por pago tambien se verificaron con pruebas unitarias.

Al ampliar la regresion a fulfillment.test.js y pagoparFlujo.test.js hubo
31 tests aprobados y 4 fallidos. Se repitieron contra un archivo limpio del
commit anterior 44f779d y dieron LOS MISMOS cuatro fallos:

- PagoPar: el test espera ciudad null y el servicio devuelve "1".
- Callback PagoPar documentado: PAID esperado, PENDING observado; el mock
  no incluye un modelo que el controller consulta.
- Callback PagoPar con firma vieja: espera 400 y obtiene 500 por ese mock.
- Fulfillment: el test no encuentra el deposito 10 en el resultado esperado.

No se modificaron esos modulos ni sus tests para ocultar los fallos. No se
afirma que toda la suite del proyecto este verde ni que se haya probado el
proveedor PagoPar real. La copia de comparacion se conserva en
`C:\Proyectos\Gesicom\tmp\speedbox-baseline-44f779d`.

### Preview del panel

`npm run preview:speedbox` repite las pruebas y deja servicios locales con
datos ficticios para revisar el panel. Muestra URL, login demo y comando STOP.
El registro no tiene un destino real hasta contar con la URL oficial; en la
preview queda deshabilitado. No usar esa base o esos IDs en produccion.

## 10. Abastecimiento, inventario y finanzas (puntos 3, 4 y 5)

Ver `docs/SPEEDBOX-ABASTECIMIENTO.md`: explica la implementacion, la migracion,
los recorridos manuales y los 36 escenarios E2E. La nueva corrida incluye
recepcion propia/Gesicomm, dos propietarios en el mismo centro, variantes,
pagos rechazados/validados, ingresos con diferencias, pedidos mezclados,
devoluciones y conciliacion desde el navegador.

El registro de clientes en Speedy queda expresamente para la siguiente etapa.

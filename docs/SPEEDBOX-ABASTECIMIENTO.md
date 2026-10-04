# Speedbox y abastecimiento: walkthrough de los puntos 3, 4 y 5

## Alcance y aislamiento

Trabajo en `codex/speedbox-integration`, dentro de los checkouts aislados
`C:\Proyectos\Gesicom\speedbox-backend` y `C:\Proyectos\Gesicom\speedbox-frontend`.
No se modifico el desarrollo actual en los repositorios originales ni se
migro la base real. El registro de clientes en Speedy queda para despues.

Se mantiene la regla acordada: el pedido se envia a Speedbox al confirmarlo,
aunque el abastecimiento siga pendiente de pago. El envio remoto no valida
ese pago, no recibe mercaderia y no liquida el cobro al cliente.

## 3. Recepcion e inventario

Se reutilizan tres circuitos existentes, sin mezclarlos:

| Circuito | Momento de acreditacion | Efecto |
| --- | --- | --- |
| Solicitud de reposicion a deposito propio | El comercio confirma recepcion al final del transporte | Suma producto o variante y su ubicacion |
| Solicitud de reposicion a centro Gesicomm | Admin habilita disponible, despues de recibir | Acredita la ubicacion del propietario; no vuelve a sumar el catalogo global ya contabilizado |
| Ingreso de mercaderia propia a Gesicomm | Recepcion fisica, conteo y habilitacion administrativa | Acredita solo unidades aceptadas; traslado no aumenta stock global |
| Abastecimiento asociado a una venta | Recepcion operativa del flujo de esa venta | No suma disponible: las unidades ya se reservaron al confirmar |
| Entrega/devolucion Speedbox | Evento logistico del pedido al cliente | No es recepcion de abastecimiento; devolucion requiere inspeccion |

Cambios concretos:

- Nueva funcion transaccional `inventarioUbicacion.service.acreditar`: valida
  destino activo, propietario para deposito propio y pertenencia de variante.
  Serializa la primera fila con advisory lock e incrementa atomicamente.
- Las claves y consultas incluyen propietario, producto, variante y deposito.
  Dos comercios pueden tener el mismo SKU en el mismo centro sin compartir
  reservas. Dos recepciones concurrentes no pierden unidades.
- Dos indices unicos parciales cubren variantes y productos sin variante;
  el indice anterior no distinguia propietario y permitia duplicados con NULL.
- Recepcion propia actualiza la variante elegida y recalcula el stock padre.
  Las variantes ajenas/inactivas, cantidades fraccionarias y destinos
  invalidos se rechazan. El historial participa en la misma transaccion.
- El pedido manual ahora conserva `variante_id` y `componente_variante_id`.
  Un producto con variantes exige seleccion. Speedbox recibe el SKU exacto.
- Reservas, despacho, cancelacion y devolucion filtran inventario por dueno.
  Los movimientos bloquean productos antes de variantes/ubicaciones; pedidos
  con multiples productos usan un orden estable de bloqueo.
- El stock del deposito trackeado se respeta antes del reparto generico
  salon/deposito. Una cancelacion previa al despacho conserva esa ubicacion.
- Recetas repetidas se agrupan antes de calcular abastecimiento: no se usa
  dos veces el mismo stock previamente adquirido para eximir compras nuevas.
- Un pedido con origenes incompatibles responde 409 sin guardar reservas
  ni enviarse a Speedbox. Un pedido con varias lineas del mismo origen funciona.
- `devuelto` remoto nunca repone automaticamente. La inspeccion admite
  vendible/danado por componente, recupera variante y ubicacion solo para
  vendible, y exige inspeccionar todo antes de cerrar el pedido. Al cerrar,
  se resuelve la revision del evento correspondiente, sin duplicar unidades.
- Un ingreso no habilita stock con items sin contar. No se acepta cantidad
  negativa/fraccionaria ni mas unidades aceptadas que fisicamente recibidas.

Archivos principales: `src/services/solicitudAbastecimiento.service.js`,
`src/services/ingresoInventario.service.js`, `src/controllers/envioController.js`,
`src/services/inventarioUbicacion.service.js`.

## 4. Dinero y conciliacion

El panel Mi tienda > Speedbox muestra separados venta, envio al cliente,
fulfillment, costo de abastecimiento, validacion del pago al proveedor,
modalidad de cobro al cliente y estado de liquidacion. Las solicitudes
muestran mercaderia y transporte hasta deposito por separado.

La billetera es otro registro. Cada movimiento conserva payload, ID remoto,
fecha y origen. No se calcula un saldo ni se acredita otro libro contable.

Para conciliar un movimiento con ID remoto:

1. Abrir el icono de conciliacion de su fila.
2. Elegir explicitamente Pago al proveedor, Costo de abastecimiento, Envio,
   Cobro al cliente u Otro.
3. Seleccionar un pedido propio o solicitud propia. Cobro al cliente requiere
   pedido de venta. Otro permite no asociar referencia.
4. Escribir la nota de cotejo y confirmar.
5. Se guarda concepto, referencia, nota, usuario, fecha, importe, moneda,
   direccion y event_key en `SpeedboxEvento.conciliacion`.

Credito no se clasifica como pago/costo; debito no se clasifica como cobro.
Reintegros/ajustes requieren Otro, sin deducir la causa de la direccion.
Sin event_id el movimiento sigue en revision y no es conciliable. Una
clasificacion identica repetida es idempotente; una diferente se rechaza
con 409, para impedir sobrescribir la evidencia sin un proceso de auditoria.
No se implemento una correccion posterior desde UI.

Conciliar no cambia pagos pendientes/rechazados/validados, estado financiero,
reservas ni recepciones. La validacion administrativa del comprobante y la
rendicion existente siguen siendo los procesos autorizados para esos cambios.
La clasificacion no demuestra por si sola un pago efectivo al proveedor.

Endpoint nuevo: `POST /api/integraciones/speedbox/eventos/:id/conciliar`, JWT,
ownership, validacion estricta y bloqueo de fila. El body admite exclusivamente
`concepto`, `envio_id`, `solicitud_id`, `nota`.

Archivos: `src/services/speedbox/finanzas.js`, `src/routes/speedbox.js`,
`src/services/speedbox/service.js`; frontend `src/pages/tienda/SpeedboxConfig.jsx`.
Las listas del panel son recientes: 50 pedidos/eventos y 100 solicitudes.

## Migracion y despliegue

`migrations/20261002200000-speedbox-abastecimiento.js` se aplica al iniciar:

1. Bloquea/audita inventario por propietario/producto/variante/deposito.
2. Si hay duplicados historicos, revierte y exige auditarlos. No fusiona
   cantidades ni reasigna duenos. El backend no inicia con aislamiento parcial.
3. Crea indices nuevos y elimina exclusivamente el indice viejo conocido.
4. Amplia `Envio.abastecimiento_estado` a VARCHAR(60) si era menor: el estado
   `preparando_envio_a_deposito_cliente` no entraba en VARCHAR(30).
5. Agrega JSONB nullable `speedbox_eventos.conciliacion` si falta.

Es idempotente. No ofrece rollback automatico al indice viejo: varios
propietarios ya validos podrian dejar de caber. Antes de desplegar, hacer
backup y correr en staging; auditar las filas duplicadas o historicamente
atribuidas al propietario incorrecto, sin asumir cantidades correctas.

## 5. Prueba E2E ejecutada

Corrida cerrada: `C:\Proyectos\Gesicom\tmp\speedbox-e2e-1790988965833\report.json`.
02/10/2026, 21:56:05 a 21:56:25, America/Asuncion. **36/36 aprobados**;
`cleanup_errors=[]`. Browser Chromium, frontend real, JWT/cookies reales,
rutas/services reales y PostgreSQL descartable, nunca la DB configurada en .env.

Solo se sustituyen dependencias externas: transporte Speedbox por un simulador
HTTP local con credenciales ficticias y upload R2 por almacenamiento de prueba.
Multer, procesamiento de comprobantes, transacciones y estados no se simulan.
Correo externo queda deshabilitado. Esto no valida Speedbox ni R2 reales.

Pasos 01-23: regresion de conexion, envio, ID remoto, stock, duplicados,
webhook, updates/cursor, aislamiento, errores 500, reintentos inciertos,
devolucion simple, eventos anticipados, envio al confirmar y rollback de outbox.

| Paso | Recorrido y resultado esperado verificado |
| --- | --- |
| 24 | Pago pendiente, comprobante, rechazo, reenvio y validacion: no acredita stock anticipadamente |
| 25 | Transporte propio y dos recepciones concurrentes: una 200, otra 400; Rojo +2, Azul sin cambios |
| 26 | Recepcion Gesicomm: destino propio invalido; dos comerciantes mantienen 3 y 4 unidades separadas en el mismo centro |
| 27 | Dos acreditaciones concurrentes sin variante: una fila con 2 unidades; el duplicado fisico se rechaza |
| 28 | Variantes en depositos distintos: 409 y rollback completo, cero pedidos externos; omitir variante: 400 |
| 29 | SKU CAT-AZUL, reserva solo del propietario, devuelto no repone; inspeccion incompleta revierte; 1 vendible y 1 danado, sin doble reposicion |
| 30 | Conciliacion desde navegador, referencia explicita y nota persistida; pago proveedor sigue pendiente y cliente sin liquidar |
| 31 | Rechaza otro propietario, direccion incorrecta, dos referencias, referencia inexistente, cambio silencioso y movimiento sin ID |
| 32 | Dos lineas del mismo origen: envio y entrega idempotente, otro propietario intacto; receta repetida de 4 unidades con 2 propias cobra solo 2 compras nuevas |
| 33 | Ingreso con dos variantes: declarado 5, aceptado 3; conteo incompleto bloqueado; habilitacion repetida no duplica |
| 34 | Duplicados historicos inyectados: migracion falla conservando cantidades 2 y 7, sin fusion |
| 35 | Venta con abastecimiento: pendiente/rechazado/validado, PROPIA y GESICOMM hasta recepcion; una llamada Speedbox por venta y cero reposicion de stock ya reservado |
| 36 | Capturas desktop/mobile, formularios y estado persistidos, cero errores JS no capturados y sin desborde de pagina |

Capturas junto al reporte: desktop/mobile, orders, wallet, retry y
`reconciliation-desktop.png`. Reporte incluye ubicaciones, solicitudes,
conciliaciones, pedidos y llamadas al simulador.

Pruebas focalizadas: **120/120 backend (10 suites), 11/11 frontend (2 suites)**,
build frontend aprobado; git diff --check aprobado. Regresion ampliada de
PagoPar/fulfillment: 31 aprobados y los mismos 4 fallos preexistentes descritos
en la seccion 9 del walkthrough anterior. No se afirma suite global verde.

## Repetir y analizar manualmente

Desde `C:\Proyectos\Gesicom\speedbox-backend`:

```powershell
npm run test:speedbox:e2e
npm run preview:speedbox
```

El primer comando termina y limpia sus procesos. El segundo repite el E2E y
deja una preview ficticia. Imprime URL y endpoint STOP; cerrar esa preview con
el POST indicado o Ctrl+C. Login comercio: `speedbox-e2e@example.test`,
password `E2E-Test-Only-2026!`. Admin ficticio: `admin-e2e@example.test` con
la misma password. No usar estos datos en ambientes reales.

Preview actual: `http://127.0.0.1:62015/mi-tienda?tab=speedbox`.
STOP de esta preview: POST `http://127.0.0.1:62014/__e2e/stop`.
Su E2E tambien paso 36/36 y sus servicios quedan activos intencionalmente.
La corrida cerrada referenciada arriba es independiente de esta preview.

Para una prueba de aceptacion en staging:

1. Preparar comercio A/B, centro Gesicomm, deposito propio y producto con
   variantes/SKU exactos. Configurar tarifa real hasta el deposito propio.
2. Crear solicitud PROPIA: revisar costos separados y ausencia de nuevo stock.
3. Subir comprobante, rechazar como admin, volver a subir y validar.
4. Avanzar cada tramo hasta transito a deposito; confirmar recepcion como A.
   Revisar variante/ubicacion/dueño; repetir y verificar cero unidades nuevas.
5. Repetir GESICOMM como A y B: mismo SKU/centro, propietarios separados.
6. Crear ingreso con diferencias: recibir, contar todos los items y habilitar
   solo aceptados. Repetir habilitacion y verificar cantidades intactas.
7. Confirmar pedido de stock recibido: SKU de variante exacto, sin segundo
   costo de compra. Confirmar mezcla de depositos: debe requerir separar envios.
8. Confirmar venta que requiere compra nueva: Speedbox se envia inmediatamente;
   seguir pago y recepcion de abastecimiento, sin reponer stock reservado.
9. Recibir devuelto remoto: no reponer aun. Inspeccionar vendible/danado,
   completar todos los componentes, comprobar revision cerrada y rechazo de
   una segunda reposicion. Verificar que B conserva su stock.
10. Recibir credito y debito de billetera con IDs reales; conciliar con
    concepto/referencia/nota. Comprobar que pagos y liquidaciones no cambiaron.
11. Probar webhook remoto HTTPS y los cuatro checks oficiales de Speedbox.
    No alcanza con reenviar un evento desde el simulador.
12. Revisar evidencia y autorizar despliegue tras backup/auditoria de datos.

## Pendiente externo

Registro Speedy, credenciales reales y pruebas oficiales sandbox/HTTPS siguen
pendientes. La API recibida no documenta compras mayoristas, catalogo/stock
del proveedor, recepcion de abastecimiento ni conciliacion automatica de
dinero. No se inventaron endpoints o equivalencias: las recepciones siguen
siendo confirmaciones fisicas por los actores del flujo existente.
El E2E no cubre checkout publico, carga/importacion de lotes, combos completos,
dos cuentas Speedbox externas activas ni infraestructura de produccion.

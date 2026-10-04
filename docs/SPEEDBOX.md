# Integracion Speedbox

Implementada en la rama `codex/speedbox-integration`. No habilita servicios
externos ni modifica los lotes existentes. Los SKU de productos y variantes
deben coincidir con Speedbox, como confirmo el propietario del catalogo.
La documentacion recibida no incluye consulta de catalogo ni stock del proveedor.

## Configuracion privada

Agregar al entorno del backend las variables de `.env.speedbox.example`.
`SPEEDBOX_ENABLED=true` dispara el envio despues de confirmar cada pedido y
mantiene un barrido de recuperacion cada minuto. La integracion
tambien debe estar activa por comercio y tener un courier seleccionado.
La API Key y el API Secret solo se leen en el backend; el panel no los recibe.
No copiar el entorno de produccion a las carpetas aisladas para probar.

El backend aplica la migracion `20261002150000-speedbox-integration` durante
el arranque, siguiendo el mecanismo existente. Tambien admite sequelize-cli.
Crea tablas independientes de tiendas vinculadas, pedidos y eventos. No ejecutar
el arranque ni la migracion contra la base activa sin preparar el despliegue.

Desde **Mi tienda > Speedbox**:

1. Probar conexion (GET remoto `action=spec`).
2. Vincular tienda (POST remoto `action=store`, conserva `tienda_id`).
3. Seleccionar el courier que representa Speedbox y activar la integracion.
4. Asignar el courier Speedbox al pedido y completar direccion, telefono y SKU.
5. Confirmar el pedido: al guardar la confirmacion se dispara el envio.
6. Consultar novedades y registrar el webhook en el portal de Speedbox.

La respuesta de store admite `tienda_id`, `store.tienda_id` o
`tienda.tienda_id`: el ejemplo recibido no especifica esa respuesta. Debe
comprobarse en sandbox con las credenciales reales.

La confirmacion guarda un registro pendiente en la misma transaccion que
reserva stock. Solo despues del commit se inicia la llamada al proveedor.
Esto cubre el alta ya confirmada, la confirmacion manual y la confirmacion
por pago. No espera a pagar o recibir el abastecimiento: esa es la regla
acordada con el propietario. Tampoco cambia sus estados de abastecimiento.
Un pedido pendiente creado antes de activar tambien se envia si se confirma
despues. El job recupera esos registros pendientes si el proceso se interrumpe.
Los pedidos que ya estaban confirmados antes de activar no se exportan
retroactivamente sin una accion explicita; siguen en el selector manual.
No se exportan pedidos de otros couriers. Las fallas no bloquean el checkout.

## Registro en Speedy

El apartado **Cuenta en Speedy** permite abrir el registro externo desde
Gesicom. Configurar `SPEEDBOX_REGISTRATION_URL` con la URL publica OFICIAL
que informe el proveedor. Solo admite HTTPS, sin usuario/password ni parametros
de secretos. El enlace abre otra pestana con noopener/noreferrer y sin enviar
datos personales, cookies de Gesicom o tokens al proveedor.

Sin URL configurada el boton queda deshabilitado. No se invento una URL de
registro. Sigue pendiente confirmar si el nombre Speedy corresponde al mismo
Speedbox de la documentacion recibida. La API documentada no incluye alta de
usuarios, SSO, autorizacion delegada ni conexion automatica de una cuenta
recien creada: el registro no reemplaza Vincular tienda ni crea credenciales.

## Pedido y dinero

`external_order_id` incluye ambiente, usuario e ID interno de pedido.
`order_name` usa `numero_pedido`, el correlativo visible de cada comercio.
`order_id` de Speedbox se guarda como texto, sin modificar ni convertir a Number.
El payload usa el snapshot de los componentes fisicos vendidos, tambien para
combos y ofertas. Las variantes requieren su propio `sku_variante`; no se
sustituyen por el SKU del producto padre. El precio de la linea se distribuye
entre sus componentes conservando el total comercial.

`total_price` incluye `monto` y el flete cuando lo paga el cliente. No agrega
el costo de fulfillment al importe a cobrar. `pago_anticipado` determina
`paid`/`pending`; contra entrega usa `contra_entrega`.

Cada envio guarda su payload, respuesta, intentos y error. Los errores HTTP
500 conservan la respuesta completa en `response_payload`, con secretos
redactados, para soporte. Esa respuesta no aparece en el panel.

Un timeout, una respuesta ambigua o un HTTP 5xx deja el envio `incierto`.
No se reintenta automaticamente: la guia no garantiza idempotencia remota.
Primero buscar `external_order_id` en Speedbox. Si no existe, el operador
puede autorizar el reintento desde el panel, conservando el payload original.
Si existe pero se perdio la respuesta, solicitar a Speedbox la conciliacion
del ID: esta guia no documenta un endpoint para recuperar un pedido por ID
externo. Un proceso interrumpido en `enviando` requiere el mismo procedimiento;
se bloquean reintentos durante los primeros dos minutos de esa llamada.
Mientras el envio esta en curso, aceptado o incierto, no se permite cancelar
localmente, cambiar el courier ni eliminar el pedido: liberar stock en Gesicomm
no cancela la operacion externa. La guia no incluye un endpoint de cancelacion.

## Webhook

La documentacion no especifica una firma ni una credencial para el webhook.
El receptor exige un token privado aleatorio de al menos 32 caracteres.
Puede generarse con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Registrar en el portal la URL HTTPS completa:

```text
https://<dominio-api>/api/webhooks/speedbox?environment=sandbox&token=<token-privado>
```

Debe probarse que el portal conserva los parametros de la URL. Si el proveedor
permite headers personalizados, tambien acepta `X-Speedbox-Webhook-Token`;
`environment` sigue siendo obligatorio. Esto es proteccion propia del receptor,
no una firma oficial de Speedbox. Evitar registrar query strings en los logs
del proxy para esta ruta. Mantener el token en la configuracion privada.

Se valida `X-Speedbox-Event` cuando esta presente, `event_id`, fecha, estado
y tienda. HTTP 200 confirma que el evento se guardo de forma durable.
Los eventos de un pedido aun no vinculado quedan pendientes y se reprocesan.
La clave unica `(environment, event_key)` y las transacciones evitan duplicados.
La URL requiere el ambiente correcto para evitar mezclar sandbox y produccion.

## Estados y billetera

| Speedbox | Gesicomm | Inventario |
| --- | --- | --- |
| cargado | Preparado | Mantiene reserva |
| en_camino | Despachado | Reserva a transito una vez |
| entregado | Entregado | Consume transito una vez |
| devuelto | estado_logistico Devuelto; revision pendiente | Espera inspeccion |

La entrega fisica no acredita cobros ni liquida pedidos. Si falta el metodo
de pago final, el panel muestra una revision pendiente para completarlo.
El evento no informa ese metodo ni el costo real de cada intento; no se
inventan comisiones, importes ni viajes adicionales.

Una devolucion no informa cantidades, condicion ni recepcion fisica. El pedido
permanece en su estado operativo previo y muestra la revision; se finaliza
mediante el flujo existente de devolucion por componente. No se repone stock
vendible por un simple aviso. Los estados terminales y eventos antiguos no
retroceden el pedido. Toda aplicacion relevante queda en su historial.
Si no llego el aviso de despacho, la devolucion recupera el paso a Despachado
y mueve la reserva a transito para permitir la inspeccion con el flujo existente.

`updates` conserva `next_since_at` solo despues de guardar todos los eventos.
Un fallo vuelve a procesar la pagina, con deduplicacion. Los movimientos de
billetera quedan registrados en el panel, separados de las liquidaciones
locales. Si updates omite `event_id`, se guarda una observacion deduplicada
por contenido y pendiente de revision: dos transacciones identicas sin ID ni
fecha no se pueden distinguir. No se calcula saldo ni se acredita dinero
automaticamente a partir de esas observaciones.

## Rutas autenticadas

Todas pertenecen al usuario de la sesion; no aceptan un usuario desde el body.

| Metodo | Ruta | Funcion |
| --- | --- | --- |
| GET | /api/integraciones/speedbox | Configuracion, checks, pedidos y eventos propios |
| PUT | /api/integraciones/speedbox | `{courier_id, activo}` |
| POST | /api/integraciones/speedbox/spec | Verifica autenticacion |
| POST | /api/integraciones/speedbox/store | Vincula tienda |
| POST | /api/integraciones/speedbox/updates | Consulta novedades |
| POST | /api/integraciones/speedbox/pedidos/:id/enviar | Envia pedido confirmado propio |
| POST | /api/integraciones/speedbox/pedidos/:id/reintentar | Reintento manual; `acknowledge_uncertain:true` si es ambiguo |

## Validacion y produccion

Las pruebas unitarias usan modelos simulados. El E2E de `test-speedbox/run.cjs`
usa navegador, rutas de produccion y PostgreSQL real en un cluster nuevo;
solo Speedbox se reemplaza por un servidor HTTP local. No accede a la base
existente ni envia pedidos al proveedor. Las cuatro marcas del panel durante
esa prueba pertenecen exclusivamente a los datos ficticios del cluster local;
no completan las cuatro validaciones del portal Speedbox. Ver resultados,
evidencias y pasos en [SPEEDBOX-WALKTHROUGH.md](SPEEDBOX-WALKTHROUGH.md).

Faltan credenciales de sandbox, comprobar la respuesta real de store, realizar
el pedido de prueba, consultar updates y verificar un webhook desde Speedbox.
Luego solicitar la habilitacion de produccion al proveedor. Para cambiar de
ambiente configurar `SPEEDBOX_ENVIRONMENT=production`, el endpoint HTTPS
de produccion informado por Speedbox y las credenciales/token de ese ambiente.
Vincular la tienda nuevamente: los IDs y cursores estan separados por ambiente.
El endpoint de produccion no se presume a partir del nombre del sandbox.

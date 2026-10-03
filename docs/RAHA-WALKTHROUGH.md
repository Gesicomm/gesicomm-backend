# Conexion Raha: solicitud y revision manual

## Alcance

Implementado en los worktrees `speedbox-backend` y `speedbox-frontend`, rama
`codex/speedbox-integration`. Los otros checkouts y las bases reales no se modificaron.
Raha se mantiene separado de Speedbox: este formulario no crea una cuenta externa,
no configura credenciales logisticas ni altera pedidos, inventario o billeteras.

Como no se proporciono un endpoint ni destinatario de Raha, el circuito implementado
es: comercio -> administradores del mismo inquilino en Gesicom -> envio manual a Raha.
El ZIP permite enviar el expediente por el canal que Raha indique. No se envia
automaticamente por email ni se presupone que Raha aprobo una solicitud.

## Comercio

En **Mi tienda > Conexion Raha** (`/mi-tienda?tab=raha`):

- Razon social, RUC, representante legal y cedula.
- Email, telefono, direccion, ciudad y departamento.
- Actividad economica, tipo de productos vendidos y operaciones estimadas por mes.
- Banco, titular, numero de cuenta y moneda PYG/USD.
- Constancia de RUC y cedula: adjuntos obligatorios para presentar.
- Respaldo bancario, imagenes de productos y documentos adicionales: opcionales.
- Guardar borrador permite completar en distintas sesiones.
- Presentar exige todos los campos, ambos documentos y autorizacion explicita para
  revisar y compartir manualmente con Raha. El borrador no entra en la bandeja admin.
- PDF/JPG/PNG/WebP: hasta 8 MB por archivo, 12 adjuntos por solicitud.
- Errores de red/validacion y cargas no borran los datos escritos.

No se copian estos datos privados al catalogo publico de la tienda.

## Administracion

**Panel admin > Dashboard > Solicitudes Raha**, o `/admin/raha`.

1. Filtrar solicitudes por estado y seleccionar una.
2. Revisar los datos y descargar los adjuntos autenticados.
3. Descargar expediente: ZIP con `resumen.pdf`, `solicitud.json` y todos los adjuntos.
4. Registrar **Requiere correcciones** con una nota para el comercio, si hace falta.
5. El comercio corrige, reemplaza/agrega documentos y vuelve a autorizar/presentar.
6. Enviar el expediente a Raha por el canal autorizado, fuera de Gesicom.
7. Registrar **Enviada manualmente a Raha** con nota y referencia del envio.
8. Cuando llegue la respuesta, registrar aprobacion o rechazo. Aprobacion exige
   referencia de la respuesta y solo se admite despues de registrar el envio.

Los mensajes de revision quedan visibles para el comercio. Las notificaciones
in-app enlazan a la bandeja admin o a la solicitud del comercio, segun destinatario.
No incluir secretos ni datos internos en una nota destinada al comercio.

## Estados y concurrencia

`borrador -> en_revision -> observada -> en_revision`

`en_revision -> enviada_raha -> aprobada / rechazada / observada`

Tambien es posible rechazar durante la revision de Gesicom con nota.
Solo borrador/observada son editables. Aprobacion y rechazo son finales; para pedir
correcciones se debe elegir observada, no rechazada.

Cada cambio usa una version y bloqueos transaccionales. Una pantalla desactualizada
recibe 409 en vez de sobrescribir el trabajo de otra persona. Repetir una presentacion
identica tras perder la respuesta HTTP no duplica historial ni notificacion.
El historial registra autor, fecha, estado y referencia; cada presentacion conserva
una copia de los datos, consentimiento y hashes de sus adjuntos. No significa que
la aprobacion externa haya sido verificada automaticamente: la registra un admin.

## Almacenamiento y despliegue

Migracion idempotente `20261003010000-raha-solicitudes.js`: tablas nuevas
`raha_solicitudes` y `raha_documentos`, sin modificar las tablas de Speedbox.
El arranque aplica la migracion antes de validar el esquema; tambien se puede ejecutar
por el mecanismo de migraciones del repositorio. Respaldar antes de desplegar.

**Produccion requiere `RAHA_PRIVATE_BUCKET`**, un bucket R2 separado del bucket publico
`R2_BUCKET_NAME`. Deshabilitar r2.dev y cualquier dominio publico/custom de ese bucket.
Usar las credenciales R2 privadas del servidor con permisos para ese bucket.
El programa rechaza reutilizar el nombre del bucket publico y no tiene fallback local
en produccion. Ver `.env.raha.example`; no se almacenan claves en frontend.

En desarrollo/test se usa `RAHA_PRIVATE_STORAGE_PATH`, fuera de directorios estaticos.
El default `storage-private/` esta ignorado por Git y no se publica con express.static.
No almacenar documentos reales en la demo: son datos de prueba y su base es desechable.

Las descargas pasan por JWT y autorizacion por propietario/inquilino; no se generan
URLs publicas o firmadas reutilizables. Las respuestas usan `private, no-store` y
adjuntos con `nosniff`. No se devuelven claves de almacenamiento.
Se validan firma basica de PDF y decodificacion de imagen; las imagenes se recodifican
sin EXIF. Esto no es un antivirus: PDFs no se ejecutan/renderizan inline en Gesicom.

Antes de usar datos reales: verificar el bucket privado con y sin autenticacion,
TLS, cifrado/backup de la base, permisos de operadores, politica de retencion/borrado
y canal autorizado de Raha. El ZIP descargado contiene informacion sensible y debe
guardarse/enviarse con la misma proteccion. No configurar directorios privados como
uploads estaticos. Un fallo al limpiar un archivo eliminado se registra para revision.

## Prueba reproducible

Desde el backend aislado:

```powershell
npm run test:speedbox:e2e
npm run preview:speedbox
```

El runner crea PostgreSQL nuevo en puerto aleatorio y Vite/Express locales. No usa
las DB_* reales ni el puerto 5434. Speedbox se simula en la frontera HTTP; Raha no
recibe ninguna comunicacion externa. Al terminar la prueba se detienen sus recursos.
El modo preview queda disponible hasta hacer POST a la URL `/__e2e/stop` que imprime.

Las pruebas previas de pedidos/abastecimiento siguen incluidas (01-36). Raha agrega:

| Paso | Verificacion |
| --- | --- |
| 37 | Formulario real, borrador privado, campos, consentimiento, error conserva datos y version |
| 38 | Multipart real, PDF falso/SVG/archivo grande rechazados, imagen recodificada, descargas privadas |
| 39 | Presentacion idempotente, snapshot, notificacion, edicion bloqueada y aislamiento de inquilino |
| 40 | Admin en navegador, ZIP/PDF/JSON/adjuntos, correcciones y nueva presentacion |
| 41 | Referencias del envio/aprobacion, transiciones invalidas y revision desactualizada |
| 42 | Capturas desktop 1440 y mobile 390, sin desbordamiento ni errores JS |
| 43 | Limite 12, eliminacion en borrador, version desactualizada y demo editable separada |

Los artifacts quedan en `../tmp/speedbox-e2e-<timestamp>/report.json`, capturas
`raha-*` y `raha-expediente.zip`. No contienen datos reales.

## Walkthrough manual de prueba

1. Abrir la URL preview impresa por el runner; entrar como `other-e2e@example.test`
   con `E2E-Test-Only-2026!`. Su solicitud Raha es un borrador editable prellenado.
2. Ir a Mi tienda > Conexion Raha; cambiar productos y guardar borrador.
3. Recargar: comprobar persistencia y ceros iniciales del numero de cuenta.
4. Autorizar y presentar sin documentos: debe informar que falta constancia de RUC.
5. Adjuntar documentos ficticios PDF/imagenes de RUC y cedula, e imagen de producto.
6. Presentar. Debe quedar en revision de Gesicom y bloquear las modificaciones.
7. En otra sesion, entrar como `admin-e2e@example.test`, misma clave, e ir a `/admin/raha`.
8. Descargar expediente y verificar resumen y archivos. Elegir requiere correcciones,
   agregar una nota y registrar. El comercio debe ver la nota y poder corregir.
9. Corregir, autorizar y presentar de nuevo. En la demo, simular envio manual con una
   referencia de prueba; no enviar nada realmente a Raha.
10. Simular respuesta de aprobacion con referencia de prueba. Debe quedar finalizada.
11. Intentar descargar el adjunto sin sesion o desde otra tienda/inquilino: 401/404.
12. Probar mobile, archivo mayor a 8 MB, formato invalido y dos pantallas con versiones
    distintas. Deben conservar datos y mostrar errores, no duplicar ni sobrescribir.

La cuenta `speedbox-e2e@example.test` conserva la solicitud que el E2E aprobo de forma
simulada y los pedidos Speedbox. No confundirla con una aprobacion real de Raha.

Pendiente externo: destinatario/canal real de Raha, configuracion y verificacion del
bucket privado en produccion y requisitos adicionales que Raha pueda pedir.

## Resultado verificado

Ejecucion cerrada: `C:/Proyectos/Gesicom/tmp/speedbox-e2e-1791002670920/report.json`:
43/43 pasos aprobados y `cleanup_errors: []`. Tambien: 124 pruebas de backend,
15 de frontend y build Vite correcto. Se verifico escritorio y movil del comercio
y de administracion. El modo preview genera otra base nueva, independiente.

El build se exporto a `../tmp/raha-frontend-build-20261003` porque el directorio
`dist` anterior tenia archivos protegidos. Las advertencias de chunks grandes
preexistentes siguen presentes. Esto no afirma que toda la suite del repositorio
este verde: las cuatro fallas ajenas documentadas en `SPEEDBOX-ABASTECIMIENTO.md`
no forman parte de esta verificacion enfocada ni se modificaron.

R2 productivo y el envio/aprobacion reales de Raha no se probaron; las pruebas
de adjuntos usan archivos privados locales reales y los estados externos son
registros manuales simulados, con referencias identificadas como E2E.

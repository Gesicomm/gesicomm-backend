# Solicitudes de proveedores

La landing envía las postulaciones a `POST /api/publico/solicitudes-proveedores`.
El administrador las revisa en `/admin/solicitudes-proveedores`, con filtros de
pendientes, aceptadas y rechazadas. Rechazar requiere un motivo; ambas decisiones
guardan administrador, fecha y nota interna. La revisión no crea usuarios ni envía
correos automáticos.

Las postulaciones anteriores siguen en `mensajes_contacto` y aparecen en la misma
bandeja. La migración `20261029170000-revision-solicitudes-proveedores.js` agrega
columnas, conserva los mensajes y se ejecuta al iniciar el backend. Es idempotente;
el rollback de aplicación debe conservar esas columnas y las decisiones.

## Verificación

- `npx jest src/tests/solicitudProveedor.routes.test.js --runInBand`: validación,
  acceso exclusivo del administrador, filtros, decisiones y conflictos.
- Con Vite en `http://localhost:5173`, ejecutar `node test-provider-requests/run.cjs`.
  Requiere PostgreSQL 17 instalado en Windows (o configurar `PROVIDER_E2E_PG_BIN`).
  Crea y detiene una base temporal en `../outputs`, sin usar la configuración de
  producción. Comprueba la migración repetida, solicitudes anteriores, el formulario
  real, HTTP, persistencia, aceptar/rechazar, teclado, concurrencia y ocho combinaciones
  de ancho y tema. Guarda capturas en esa carpeta.

La prueba integrada usa autenticación simulada únicamente dentro del proceso de
prueba; las rutas, el servicio, el modelo y las decisiones usan código real.

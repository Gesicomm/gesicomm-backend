# Personas y permisos

La tarjeta de Configuración administra colaboradores de la tienda activa. Solo
el propietario puede crear personas, editar permisos y revocar accesos. No convierte a
los colaboradores en administradores del sistema.

## Alcance

- 16 secciones: Mi negocio, Depósitos (incluye inventario y couriers), Productos
  (incluye combos y precios), Clientes, Mi E-commerce, Publicidad, Gestión
  Comercial (incluye configuración de seguimiento), Gestión Logística,
  Dashboard Operativo, Dashboard General, Control Financiero, Proveete con
  Gesicom, Quiero ser afiliado, Partner certificado, Academia y Configuración.
- Cada sección admite sin acceso, solo ver y, si tiene operaciones de escritura,
  ver y gestionar. Dashboards y Clientes son módulos de consulta.
- Los catálogos auxiliares de los editores se consultan sin heredar escritura.
- Personas, emisión de credenciales API, eliminación de cuenta/tienda y
  administración de plataforma siguen reservadas al propietario o administrador.
- Los recursos por tienda mantienen su tienda activa. Los catálogos, inventario
  global del comercio, Meta, medios de pago y programas de afiliación conservan
  su alcance existente de cuenta; se advierte al propietario en el formulario.
- `modulosAcceso.json` es el catálogo explícito (backend y frontend). Las rutas
  aprobadas están en `middleware/rutasColaborador.json`, con método HTTP y nivel.
  Un endpoint nuevo no queda habilitado automáticamente por su prefijo.

## Alta de cuentas

El propietario carga nombre, correo, contraseña inicial y permisos. La cuenta
queda activa al guardar y puede iniciar sesión inmediatamente. La contraseña se
guarda con bcrypt (coste 12), nunca se devuelve en la respuesta ni en el listado.
El formulario pide confirmarla y permite mostrarla u ocultarla antes de guardar.
La persona puede cambiar su contraseña desde su perfil.

El alta no sobreescribe cuentas existentes: un correo ya registrado devuelve 409.
Para una persona ya listada se editan sus permisos o se restablece su acceso,
conservando la contraseña existente. No se requieren invitaciones para el alta.
Los manejadores de aceptación de enlaces anteriores se conservan por compatibilidad.

El nuevo rol global `colaborador` no hereda permisos de propietario. La tabla
`tienda_miembros` tiene IDs enteros, una membresía única por tienda/usuario,
estados pendiente/activo/revocado y permisos por módulo. Se admite pertenecer a
múltiples tiendas y elegir una al entrar.

## Autorización

`verificarToken` aplica `accesoColaborador` a todas las rutas autenticadas de ese
rol. Consulta la membresía en cada petición, deniega rutas no enumeradas y
distingue las consultas POST de las escrituras. La revocación o reducción de
permisos afecta al siguiente request incluso con el mismo JWT.

La identidad del actor sigue en `req.usuario.id`. `req.comercioId` delimita los
datos del propietario y se obtiene de la tienda verificada. Los pedidos y
rendiciones se filtran también por tienda. Los registros de historial de pedidos
usan la identidad de la persona. Las sesiones y el perfil siguen siendo propios.

El frontend filtra el menú, bloquea URLs directas y muestra un aviso de solo
lectura. La autorización real se ejecuta en el servidor. Las vistas operativas
existentes se conservan; algunos controles pueden permanecer visibles en modo
lectura, pero sus escrituras se rechazan.

## Migración y validación

Aplicar antes de arrancar el backend actualizado:

La ampliación de tres a dieciséis secciones no necesita otra migración: reutiliza
el JSON de permisos de la membresía. Los permisos ya asignados se conservan y
las nuevas secciones empiezan sin acceso hasta que el propietario las habilite.

```sh
node scripts/migrate-personas-permisos.js
```

Ejecuta solamente `20261025160000-personas-permisos.js`, de manera idempotente,
y registra su nombre en SequelizeMeta. No ejecuta pendientes ajenos.

```sh
npx jest src/tests/personas-accesos.test.js src/tests/personas-liquidacion.test.js src/tests/personas-crear.test.js src/tests/personas-modulos.test.js src/tests/personas-contexto.test.js --runInBand
node scripts/verify-personas-permisos.js
```

El segundo comando valida el alta directa y el ciclo de invitación compatible contra PostgreSQL dentro de
una transacción que siempre se revierte. No deja personas ni tiendas de prueba.

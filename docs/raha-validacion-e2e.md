# Validación RAHA — 19 de octubre de 2026

## Resultado y alcance

Se verificaron 13 escenarios con Chromium, rutas Express, autenticación
real y PostgreSQL descartable. No se interceptaron las API de negocio.
Se ejecutaron además 100 pruebas de backend y 37 de frontend, todas
correctas, y la compilación de producción del frontend.

El comando reproducible es `npm run test:raha:e2e` desde el backend.
Las evidencias quedan en `outputs/raha-e2e-<timestamp>/report.json`, junto
con las capturas de escritorio y móvil y los logs del clúster aislado.

Esto no certifica una entrega con el proveedor externo en vivo: los pedidos
y eventos logísticos de abastecimiento se sembraron en la base aislada.
La creación de solicitudes de envío, publicación de depósitos, estados,
consultas y persistencia sí se ejecutaron contra los servicios reales.
No se enviaron pedidos externos ni se modificó inventario operativo.

## Correcciones

1. **Catálogo incompleto:** la pantalla consultaba solamente ubicaciones
   con existencias. Ahora pagina el catálogo permitido completo, incorpora
   variantes activas, busca por nombre/SKU y distingue cantidades declaradas
   de existencias registradas. Un saldo registrado insuficiente se rechaza;
   una ubicación sin inventario permite declarar la cantidad sin crear stock.
2. **Estados faltantes:** el comercio puede marcar Preparado y Enviado;
   solo RAHA puede confirmar Recibido después del envío. Quedan registrados
   autor, fecha y versión. No se permite cancelar después de enviar.
3. **Accesos:** Mis depósitos muestra Agregar depósito, Abastecerme, Ver RAHA
   y Enviar mercadería a RAHA, en una fila de ancho completo en escritorio.
   Abastecerme consulta todos los depósitos propios activos de la tienda,
   no solamente los visibles en la página o filtro actual.
4. **Migración:** se agregó `20261019160000-raha-envios-estados-logisticos.js`
   para ampliar la restricción de estados y se aplicó a la base local
   configurada. Se probó su ejecución repetida y la protección de reversión
   cuando ya existen registros con los estados nuevos.

## Escenarios verificados

- Creación de clúster y aplicación de las migraciones reales.
- Inicio de sesión de comercio por API y sesión HttpOnly; login de RAHA
  mediante formulario, bcrypt y JWT propio.
- Publicación de destino desde RAHA y selección desde el comercio.
- Catálogo con y sin inventario, variantes, búsqueda y paginación en API
  y navegador; exclusión de variantes inactivas y productos privados ajenos.
- Orden y alineación horizontal de los cuatro accesos.
- Solicitud de cantidad declarada creada desde el navegador.
- Preparado → Enviado → Recibido entre dos sesiones independientes.
- Historial persistido; rechazo de recepción anticipada o por el comercio.
- Reintentos simultáneos con el mismo UUID crean una sola solicitud.
- Conflicto de versión: un cambio concurrente gana y el otro responde 409.
- Filtros, fechas inválidas y conservación de direcciones históricas.
- Aislamiento entre usuarios, inquilinos y dos tiendas del mismo propietario.
- Pantallas de 390 y 1440 píxeles sin desbordamiento general ni errores JS.
- Abastecimientos reales consultados desde ambas vistas, eventos del
  propietario correcto, identificador remoto preservado, precios, stock,
  pago contra entrega y ausencia de payloads privados.

## Continuación recomendada

### Prioridad 1: transferencias físicas

- Vincular cada destino RAHA publicado a una ubicación real de inventario,
  conservando la propiedad de la mercadería del comercio.
- Definir cantidades solicitadas, preparadas, enviadas, recibidas y
  discrepancias por producto/variante; admitir recepción parcial y daños.
- Implementar un libro de movimientos e idempotencia por operación física:
  reservar o descontar en origen al despachar, mantener tránsito y acreditar
  en destino solo lo recibido, con transacciones y bloqueo de existencias.
- Conciliar antes el stock sin ubicación. Una cantidad declarada no debe
  transformarse silenciosamente en una existencia verificable.
- Evitar sobrecompromisos entre distintas solicitudes: hoy se coordinan
  envíos, pero no se reserva stock. Dos solicitudes pueden compartir saldo.
- Probar duplicados, concurrencia, reintentos, cancelaciones, recepción
  parcial y conciliación con la integración antes de habilitar movimientos.

### Prioridad 2: operación y seguimiento

- Notificar solicitudes nuevas, observaciones, despacho y recepción.
- Incorporar responsable, referencia de transporte y fecha prevista.
- Permitir corregir una solicitud observada conservando versiones e historial.
- Agregar permisos granulares de operador y auditoría por acción.
- Ejecutar una validación adicional con el sandbox externo y sus webhooks
  para certificar la comunicación proveedor → aplicación, no solo las vistas.

### Pagos anticipados: siguiente etapa, separada

Mantener estados financieros independientes de los logísticos. Definir
cuentas receptoras, snapshot de datos de pago, comprobantes privados,
validación, conciliación y reintentos idempotentes antes de habilitar cobros.
No se implementaron pagos anticipados en esta entrega.

# Rendimiento de /mi-catalogo — 14 de octubre de 2026

## Incidente confirmado y recuperación

La base conectada por la configuración local tenía una transacción de productos
abierta durante más de 90 minutos. Seis `ALTER TABLE productos ADD COLUMN IF
NOT EXISTS` del script de arranque esperaban `AccessExclusiveLock`. PostgreSQL
dejaba las nuevas lecturas esperando detrás de esos cambios de estructura; había
19 sesiones esperando locks, incluidas las consultas de catálogo.

Se cancelaron exclusivamente esos seis DDL que aún no habían obtenido el lock.
La lectura de productos respondió en 240 ms desde el equipo local. La transacción
de carga pudo continuar y en la verificación final había cero sesiones esperando
locks. No se terminó la sesión de importación ni se borraron productos.

El script `migrar-stock-salon-deposito.js` ahora inspecciona primero las columnas.
Si existen, retorna sin DDL ni backfill. Si faltan, limita la espera del lock a
3 segundos y realiza la modificación y el backfill en una transacción.

## Cambios aplicados

- Se crearon y verificaron seis índices válidos con `CREATE INDEX CONCURRENTLY`:
  catálogo activo por tenant/nombre, tenant/creador/nombre, combos activos por
  tenant/nombre, SKU normalizado por tenant y dos GIN trigram para buscar en
  nombre y descripción corta de productos. La migración es idempotente y repara
  índices propios inválidos de un intento concurrente interrumpido.
- La consulta de página reutiliza el precio y la categoría personalizada de su
  JOIN. Se eliminaron las dos consultas adicionales de precios de la página.
- La consulta de administradores se ejecuta junto con el conteo y la página.
  Imágenes, categorías personalizadas, precios de componentes de combos y
  opciones comerciales se leen en paralelo después de cargar los IDs necesarios.
- El SELECT que ordena la página omite descripciones y desempata por tipo e ID.
  Se conservan los filtros de tenant, creador y tienda, así como los DTO completos.
- La búsqueda espera 300 ms desde la última tecla. Los cambios de filtros y el
  desmontaje cancelan peticiones anteriores; el servicio limita la espera HTTP
  a 20 segundos. La cancelación HTTP no sustituye un timeout SQL del servidor.

## Verificación

Comparación alternada del código anterior y del modificado, usando la misma base
remota y conexiones reutilizadas después de liberar los locks:

| Ejecución | Anterior | Modificado | Consultas anterior/nuevo |
| --- | ---: | ---: | ---: |
| 1 | 2014 ms | 676 ms | 12 / 10 |
| 2 | 1234 ms | 645 ms | 12 / 10 |
| 3 | 1182 ms | 621 ms | 12 / 10 |

En la tercera comparación la respuesta completa fue idéntica. Las primeras
dos ocurrieron mientras se importaban productos y variaba el total entre llamadas.
El tiempo de ejecución de PostgreSQL para la página fue 2,73 ms con EXPLAIN
ANALYZE; la latencia de red y las rondas de consultas dominan después del desbloqueo.
Estos tiempos corresponden al servicio desde el equipo local, no a una medición
del navegador en producción.

Pasaron 25 pruebas de backend y 16 de frontend, incluidas regresiones de precios
personalizados, categorías, aislamiento de visibilidad, combos, búsqueda agrupada,
cancelación e importación desde Productos propios.

## Mejoras adicionales identificadas

- El arranque aún contiene otras migraciones históricas con DDL repetido. Conviene
  trasladarlas a migraciones versionadas ejecutadas durante el despliegue, con
  límites de espera, para evitar otra cola similar en otras tablas.
- Hay decenas de índices únicos duplicados sobre `usuarios.correo_electronico`.
  Revisar sus restricciones y dependencias antes de retirar redundancias; penalizan
  las escrituras y ocupan espacio. No se eliminaron durante esta intervención.
- Supervisar sesiones `idle in transaction` y consultas esperando locks. La
  importación observada mezclaba consultas dentro y fuera de su transacción;
  revisar ese flujo completo y sus límites de duración al abordar importaciones.

Los índices y el desbloqueo ya se aplicaron a la base conectada. Los cambios de
backend y frontend están en el workspace y necesitan desplegarse para proteger
el arranque y mejorar la pantalla publicada. No se desplegaron los demás cambios
locales existentes.

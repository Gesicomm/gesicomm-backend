# E2E Speedbox aislado

Ejecuta el frontend real, las rutas y servicios del backend y PostgreSQL real.
Solo Speedbox se sustituye por un servidor HTTP local. No consulta el sandbox
externo ni envia pedidos al proveedor. No necesita credenciales reales.

## Requisitos

- Node.js y dependencias instaladas en backend y frontend.
- PostgreSQL con `initdb`, `pg_ctl` y `createdb`.
- Frontend en `C:\Proyectos\Gesicom\speedbox-frontend`, o indicar otra ruta.
- Chromium instalado para el Playwright del frontend.
- Permisos de Windows para iniciar un proceso PostgreSQL local.

En esta maquina se comprobaron Node 22.18.0 y PostgreSQL 17.6. El runner
resuelve Playwright desde las dependencias del frontend, no desde el backend.

```powershell
Set-Location C:\Proyectos\Gesicom\speedbox-frontend
npx playwright install chromium
Set-Location C:\Proyectos\Gesicom\speedbox-backend
npm run test:speedbox:e2e
```

Si las ubicaciones son distintas:

```powershell
$env:SPEEDBOX_E2E_FRONTEND = 'C:\ruta\frontend'
$env:SPEEDBOX_E2E_PG_BIN = 'C:\Program Files\PostgreSQL\17\bin'
npm run test:speedbox:e2e
```

El comando imprime `PASS` para cada escenario y `REPORT <ruta>` al terminar.
Codigo de salida 0 = todos los escenarios pasaron y recursos cerrados.
Codigo de salida 1 = revisar `report.json`, `failure.png`, `vite.log` y
`postgres-commands.log` de la corrida. Los HTTP 400, 403, 409 y 502 que se
inyectan y verifican son parte de la prueba; algunos controllers los registran
en consola como errores esperados.

## Aislamiento y fidelidad

El runner crea un cluster nuevo con datos ficticios, usuario `speedbox_e2e`,
nombre de base aleatorio y puertos disponibles. Fuerza sus propias variables
`DB_*`, JWT y Speedbox ANTES de cargar los modelos. No reutiliza `.env`, bases,
usuarios ni puertos de desarrollo/produccion. El cluster usa autenticacion
trust y escucha solo en 127.0.0.1: es exclusivamente una base efimera de prueba.
No mantener esa configuracion en un servidor compartido.

El transporte externo se redirige dentro del proceso de prueba al simulador;
el cliente Speedbox de produccion no se modifica. Las llamadas viajan por
HTTP real y conservan autenticacion, query, metodo y payload. No prueban TLS
ni el contrato real del proveedor. Se bloquean otras solicitudes externas
hechas mediante fetch y recursos externos solicitados por la pagina.

El login se ejecuta por HTTP contra la ruta real y entrega cookies HttpOnly
al navegador. El alta de pedidos se ejecuta por HTTP contra el controller
real. Configuracion, envio manual, sincronizacion y reintento se operan con
Playwright sobre el panel real; sus respuestas API no estan mockeadas.

No se arranca `server.js`: el app de prueba monta sus routers reales sin los
jobs ni migraciones historicas ajenos a esta funcionalidad. Educacion/sidebar
tiene una respuesta vacia de soporte. Las tablas base se crean desde modelos.
Se omiten temporalmente comentarios DDL para evitar un problema de Sequelize
con ENUM y asociaciones ciclicas; los atributos se restauran inmediatamente.
La migracion Speedbox SI se ejecuta tal cual, sobre tablas nuevas, dos veces.
Se prueba `runCycle()` directamente, no la espera real del cron de un minuto.

El bloque finally cierra Chromium, Vite, servidores HTTP, conexiones SQL y
SOLO el cluster propio mediante su directorio exacto. Los datos y capturas
quedan bajo `C:\Proyectos\Gesicom\tmp\speedbox-e2e-<timestamp>` para auditoria.
No se borran archivos ni bases existentes.

Ver el recorrido, resultados y checklist contra sandbox real en
[SPEEDBOX-WALKTHROUGH.md](../docs/SPEEDBOX-WALKTHROUGH.md).

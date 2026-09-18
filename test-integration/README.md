# Tests de integración — flujo Pago → Registro → Suscripción

Corren contra una Postgres real y efímera (Docker), nunca contra la base de
producción. `npm run test:integration` levanta el contenedor, bootstrapea
el esquema y lo destruye al terminar — no depende de `.env` del proyecto
para la conexión (ver `config.js` y `globalSetup.js`).

Requiere Docker corriendo localmente. Nada de esto se ejecuta en el `npm
test` por defecto ni en ningún hook automático — es un comando separado,
deliberado.

```bash
npm run test:integration
```

## Qué NO reproduce (y por qué)

El bootstrap no corre el 100% de las migraciones del proyecto — solo lo
necesario para las tablas de este flujo (`usuarios`, `roles`, `inquilinos`,
`auth_events`, `auth_notifications`, `planes`, `suscripciones`,
`pagos_suscripcion`), usando en cada caso la fuente más fiel disponible
(el script real de producción cuando existe, el modelo Sequelize cuando la
tabla es anterior a la convención de migraciones del repo). Ver los
comentarios en `globalSetup.js` para el detalle tabla por tabla.

Deliberadamente afuera: el programa de afiliados y el checkout público de
tienda (`checkout_intents`, `subscription_purchases`, `afiliados`) — son
features enteras sin relación con las garantías de concurrencia que este
harness verifica. Donde el modelo Sequelize exige columnas de esas features
(ej. `suscripciones.afiliado_id`), se agregan sin su FK real — no afecta
ninguno de los invariantes bajo prueba.

**Hallazgo de este mismo harness**: al escribirlo, `reclamarPorEmailVerificado`
tiraba `FOR UPDATE cannot be applied to the nullable side of an outer join`
contra Postgres real — un bug que ningún test con modelos mockeados podía
detectar, porque el mock nunca genera SQL de verdad. Se corrigió acotando
el lock con `of: Suscripcion` (ver `suscripcion.service.js`). Es la prueba
concreta de por qué esta capa de tests existe además de la mockeada.

## Invariantes — qué garantiza la aplicación y qué garantiza Postgres

| Invariante | Lo garantiza | Cómo |
|---|---|---|
| Un `pagos_suscripcion.referencia` es una sola compra | **Postgres** | `UNIQUE` real en la columna (verificado en `constraints.spec.js`) |
| Un `usuarios.correo_electronico` es una sola cuenta | **Postgres** | `UNIQUE` real — dos altas concurrentes con el mismo correo: una persiste, la otra recibe `SequelizeUniqueConstraintError` (verificado en `claimAtomicity.spec.js`, escenario 2) |
| Un `suscripciones.token_registro` habilita un solo alta | **Postgres** | `UNIQUE` real + el `UPDATE` condicional de la app (ver abajo) |
| Una `Suscripcion` no puede quedar reclamada por dos usuarios a la vez | **Aplicación + Postgres** | El `UPDATE ... WHERE id=X AND usuario_id IS NULL` (`vincularUsuario`, `reclamarPorEmailVerificado`) es la sección crítica: la app nunca decide en base a una lectura previa, y es el motor de `UPDATE` de Postgres el que serializa dos `UPDATE` concurrentes sobre la misma fila — solo uno puede ganar el `WHERE` |
| Un pago ya `PAID` no se re-acredita ni re-emite token | **Aplicación** (con ayuda de un lock explícito) | `acreditarPago` relee con `SELECT ... FOR UPDATE` dentro de una transacción — Postgres bloquea la fila para el segundo lector hasta que el primero commitea |
| Ambigüedad (N>1 compras pagadas sin cuenta, mismo email) nunca se resuelve adivinando | **Aplicación** | `reclamarPorEmailVerificado` cuenta candidatas ANTES de decidir; con más de una, no ejecuta ningún `UPDATE` — la regla "no elegir la más reciente" es lógica de negocio, no algo que la BD pueda imponer sola |
| Ambigüedad queda trazable para soporte | **Aplicación**, persistido en Postgres | `AuthEvent` + `AuthNotification` con las referencias de pago involucradas (verificado en `claimAtomicity.spec.js`, escenario 5) |
| Dos instancias del backend no corren el mismo barrido de reconciliación a la vez | **Postgres** | `pg_try_advisory_xact_lock` — lock nativo con alcance a la transacción, se libera solo en `COMMIT`/`ROLLBACK` sin unlock manual (verificado en `advisoryLock.spec.js` con conexiones reales separadas) |
| Una operación fallida no deja un Usuario creado sin su plan | **Aplicación**, con ayuda de transacciones de Postgres | Todo el alta (crear Usuario + reclamar Suscripcion) corre en una sola transacción; si el `UPDATE` condicional no afecta 1 fila, se hace `throw` y Postgres revierte el `INSERT` del Usuario junto con todo lo demás (verificado en `claimAtomicity.spec.js`, escenario 3) |

La distinción práctica: todo lo que es "una fila, una regla simple"
(unicidad, bloqueo de fila) se apoya directamente en Postgres y no podría
romperse aunque el código de la aplicación tuviera un bug — la BD lo
rechaza igual. Todo lo que es "una decisión de negocio sobre varias filas"
(ambigüedad, trazabilidad) es responsabilidad de la aplicación, y por eso
son justamente esos los casos que más vale cubrir con un test que hable
con Postgres de verdad y no con un mock.

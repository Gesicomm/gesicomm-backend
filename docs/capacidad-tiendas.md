# Prueba de capacidad de tiendas — 16 de octubre de 2026

## Pregunta y límites de la conclusión

El escenario solicitado es 300 visitantes simultáneos por tienda. Con 50 tiendas
son 15.000 visitantes simultáneos. Corregir el agotamiento de heap de PageView
no acredita capacidad para esa concurrencia. El VPS observado tiene 3,3 GiB de
RAM y comparte recursos entre Node, PostgreSQL y otros servicios. Falta conocer
su CPU y medir su capacidad sostenida.

El tiempo que cada visitante pasa leyendo cambia mucho la carga. Con una
navegación cada 30 segundos y mezcla de 40% inicio, 30% categoría y 30% producto:

| Escenario | Visitantes | GET API/s | POST tracking/s | Total API/s |
| --- | ---: | ---: | ---: | ---: |
| Una tienda, 300 visitantes | 300 | 10 | 17 | 27 |
| Una tienda, 1.000 visitantes | 1.000 | 33,3 | 56,7 | 90 |
| 50 tiendas, 300 cada una | 15.000 | 500 | 850 | 1.350 |

Cada navegación emite PageView; el inicio suma visita y la ficha ViewContent.
Son estimaciones explícitas de demanda, no mediciones de capacidad. Duplicar
el intervalo entre páginas reduce aproximadamente a la mitad estas tasas.
La caché puede absorber parte de los GET; los POST de tracking siguen llegando
a Node y PostgreSQL. Imágenes, archivos estáticos y JavaScript del navegador
no están incluidos en este ejecutor de API. Tampoco se simulan ventas,
actualizaciones de stock, pagos, administradores ni importaciones simultáneas.

## Ejecutor

`scripts/carga-tiendas/ejecutar.mjs` requiere Node 22 y ningún paquete adicional.
El generador se ejecuta fuera del VPS bajo prueba: poner 15.000 visitantes
virtuales en el mismo VPS consumiría sus recursos y falsearía el resultado.

Usar un manifiesto basado en `scripts/carga-tiendas/tiendas.example.json`.
Cada entrada contiene un origen, un Host opcional para un proxy de ensayo,
slug opcional de landing, categoría real y slug real de producto.

En producción solo se admite `canary`: etapas de 1, 3 y 5 visitantes, cada uno
consulta inicio, categoría y producto una vez. Son como máximo 27 GET y 5
solicitudes simultáneas, sin POST ni pedidos. No es una prueba de 300 personas.

```bash
node scripts/carga-tiendas/ejecutar.mjs --manifiesto tiendas.json --perfil canary --salida resultado.json
```

Para las pruebas completas se necesita un entorno aislado, eventos habilitados
y Meta CAPI desactivada en sus tiendas de ensayo. El manifiesto exige declarar
estas condiciones; no las configura automáticamente. Las pruebas insertan
eventos en la base de ensayo. No copiar credenciales de Meta a ese entorno.

Perfiles disponibles:

| Perfil | Escalones de visitantes activos |
| --- | --- |
| `tienda300` | 10 → 30 → 100 → 300 |
| `tienda1000` | 10 → 100 → 300 → 1.000 |
| `tiendas50` | 50 → 500 → 1.500 → 5.000 → 15.000 |

La etapa final dura cinco minutos. Los escalones distribuyen el ingreso durante
30 segundos y cada visitante navega aproximadamente cada 30 segundos. Se usa
un modelo cerrado: si el servidor se ralentiza, la tasa ofrecida baja. Revisar
las solicitudes por segundo realmente alcanzadas, además de los visitantes
configurados. Para probar una tasa de llegada sostenida independiente de la
latencia hace falta complementar con un generador de modelo abierto.

`tiendas50` exige 50 identidades distintas. Repetir el mismo dominio 50 veces
no verifica cachés, visibilidad ni precios de 50 tiendas. El ensayo debe incluir
listas y reglas de catálogo con tamaños comparables a los clientes reales.

## Criterios y observación

El ejecutor guarda estados HTTP, fallos de negocio (también HTTP 202 con
`ok:false`), latencia p95 aproximada en cubetas de 10 ms y estados de caché.
No agrega parámetros aleatorios a las URLs: hacerlo anularía la reutilización
de caché que se quiere evaluar. Para evaluar caché fría se limpia únicamente
la del entorno aislado antes de una ejecución; después se repite con caché caliente.

Se interrumpe ante un 429. Un rate limit no demuestra ni descarta capacidad de
CPU/memoria: invalida ese escenario. Actualmente GET permite 600 solicitudes por
IP cada 15 minutos; eventos y visitas, 120 cada uno. Un generador de una sola
IP chocará con esos límites. Usar generadores con IP distintas o una
configuración de límites específica del entorno aislado; no desactivar los
límites de producción ni enviar X-Forwarded-For falsos. La configuración de
proxy debe preservar correctamente las IP de los clientes.

En producción cualquier fallo detiene el canary. En carga completa, a partir
de 20 respuestas, se detiene si más del 2% falla o más del 5% tarda más de 5 s.
Cada petición tiene timeout de 10 s. Estas metas son umbrales iniciales, no un
SLA acordado. Ctrl+C deja de generar carga y guarda los resultados.

Durante el ensayo capturar desde el host:

```bash
docker stats
```

En otra terminal:

```bash
docker logs --follow --timestamps gesicomm-back
```

Observar heap, RSS, reinicios, latencia, CPU del backend/PostgreSQL y RAM
disponible del host. El ejecutor no puede detenerse por una métrica de memoria
que no recibe: el operador debe detenerlo si el heap supera 1.200 MB y sigue
subiendo, cae la memoria disponible o hay reinicios. Observar recuperación
durante al menos cinco minutos sin carga al terminar. El heap debe
estabilizarse; no se exige que vuelva a un valor idéntico al de arranque.

El pool actual de Sequelize admite 20 conexiones. Revisar consultas en espera,
locks y tiempo de adquisición si crecen las latencias. Aumentar el pool sin
medir la capacidad de PostgreSQL puede empeorar la saturación.

## Validación local

```bash
node --test scripts/carga-tiendas/modelo.test.mjs
```

Estas pruebas verifican cálculo de escenarios, restricciones de producción,
diversidad de tiendas, URLs y corte real ante 429 usando un servidor local.
No acreditan capacidad del VPS. No se ejecutó el escenario de 15.000 visitantes
contra producción.

## Comprobación realizada en producción

El 16 de octubre de 2026, de 17:27:10 a 17:27:34 en America/Asuncion,
se ejecutó `canary` contra Llévalo Fácil desde el equipo de trabajo:

| Visitantes del escalón | GET completados | Fallos | p95 aproximado |
| --- | ---: | ---: | ---: |
| 1 | 3 | 0 | 1.200 ms |
| 3 | 9 | 0 | 990 ms |
| 5 | 15 | 0 | 950 ms |

Total: 27 HTTP 200; 25 respuestas con `X-Cache-Status: HIT` y 2 con `MISS`.
No se generaron POST, eventos de prueba, carritos ni pedidos. Se comprobaron
también las identidades de producto y la categoría de los productos devueltos.
No hubo acceso durante esta ejecución a las métricas internas del VPS:
no se atribuye un consumo de CPU o memoria a este resultado. El mejor tiempo
de los escalones siguientes puede explicarse por la caché caliente; no acredita
que aumentar concurrencia mejore el rendimiento del origen.

Esta comprobación no valida 300 ni 15.000 visitantes concurrentes y no
permite extrapolar capacidad lineal. La prueba completa queda pendiente de
un entorno aislado representativo y de resolver la limitación por IP del generador.
El ejecutor queda preparado, pero no se han ejecutado esos perfiles grandes.

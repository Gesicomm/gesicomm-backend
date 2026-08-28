-- Migración: rubro de ficha y datos propios de ese rubro, por producto.
--
-- Motivo: la página de producto de cada template rígido pide información
-- distinta. Suplementos necesita ingredientes con su dosis; Electrónica
-- necesita una tabla de especificaciones, "en la caja" y una comparativa
-- contra otras marcas. Hasta ahora eso no tenía dónde vivir a nivel
-- Producto, así que había que recargarlo en cada landing.
--
-- Por qué JSON y no columnas sueltas: cada rubro tiene su propio juego de
-- campos y van a seguir apareciendo rubros. Una columna por campo obliga a
-- una migración cada vez; el JSON deja que el rubro lo defina el frontend
-- (ver templates/*/ficha*.js) sin volver a tocar el esquema.
--
-- `ficha_rubro` es texto y no un ENUM a propósito: agregar un valor a un
-- ENUM en Postgres es otra migración, y la lista de rubros la maneja la
-- aplicación. NULL = sin rubro elegido, se comporta como hasta hoy.
--
-- Aditiva e idempotente: no toca ni reescribe ninguna fila existente, no
-- borra nada, y se puede correr más de una vez sin efecto.

BEGIN;

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS ficha_rubro VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ficha_datos JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN productos.ficha_rubro IS
  'Qué juego de campos usa la ficha de este producto: "suplementos", "tecnologia" o NULL (genérico). Decide qué pestaña de campos muestra Mis Productos y de dónde saca los datos la página de producto de la landing.';
COMMENT ON COLUMN productos.ficha_datos IS
  'Campos propios del rubro, con la forma que define el frontend. suplementos: {ingredientes:[{nombre,dosis,texto}], modo_uso}. tecnologia: {especificaciones:[{clave,valor}], en_la_caja:[texto], comparativa:[{caracteristica,nosotros,otros}]}. {} = nada cargado.';

COMMIT;

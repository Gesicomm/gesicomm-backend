-- Migración: imagen propia y ventana de vigencia para las Ofertas.
--
-- Motivo: un Pack ("2 unidades a precio especial") es una oferta comercial
-- con vida propia — puede tener su propia foto y correr solo entre dos
-- fechas. Hasta ahora una oferta solo se podía prender y apagar a mano
-- (activo), así que una promo de fin de semana había que acordarse de
-- desactivarla el lunes.
--
-- Idempotente: se puede correr más de una vez sin efecto.

BEGIN;

ALTER TABLE ofertas_producto
  ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
  ADD COLUMN IF NOT EXISTS fecha_fin DATE;

COMMENT ON COLUMN ofertas_producto.imagen_url IS
  'Imagen propia de la oferta. NULL = se usa la del producto ancla.';
COMMENT ON COLUMN ofertas_producto.fecha_inicio IS
  'Desde cuándo se ofrece (inclusive). NULL = sin fecha de inicio.';
COMMENT ON COLUMN ofertas_producto.fecha_fin IS
  'Hasta cuándo se ofrece (inclusive). NULL = sin vencimiento. Fuera de la ventana la oferta no se muestra ni se puede cobrar, aunque activo siga en true.';

-- Las ofertas que ya existen no tenían ventana: quedan sin fechas, o sea
-- vigentes siempre. No se toca `activo`.
CREATE INDEX IF NOT EXISTS ofertas_producto_vigencia_idx
  ON ofertas_producto (fecha_inicio, fecha_fin);

COMMIT;

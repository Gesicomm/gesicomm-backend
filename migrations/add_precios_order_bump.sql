-- Migración: separar el precio "normal" de una oferta del precio promocional
-- que se cobra cuando el cliente la acepta como Order Bump en el checkout.
--
-- Motivo: hasta ahora `ofertas_producto.precio` era un único número. Al
-- configurar un Order Bump se pisaba el precio con el que esa misma oferta
-- se vende normalmente, y la reportería no podía distinguir una venta
-- originada en un bump de una venta normal.
--
-- Idempotente: se puede correr más de una vez sin efecto.
-- Postgres 12+ (ADD VALUE IF NOT EXISTS).

-- 1) Nueva estrategia "combo": la oferta se ofrece como paquete de varios
--    productos a precio fijo (ej. "3 productos x 120.000") dentro del
--    checkout, al lado del order bump.
--    Va suelta y primero: en Postgres un valor de enum recién agregado no
--    se puede usar en la MISMA transacción que lo agregó.
ALTER TYPE enum_ofertas_producto_estrategia ADD VALUE IF NOT EXISTS 'combo';

BEGIN;

-- 2) Los dos precios de la oferta.
ALTER TABLE ofertas_producto
  ADD COLUMN IF NOT EXISTS precio_normal INTEGER,
  ADD COLUMN IF NOT EXISTS precio_order_bump INTEGER;

COMMENT ON COLUMN ofertas_producto.precio_normal IS
  'Precio de la oferta vendida por el canal normal (ficha del producto / combo). Es el precio de referencia para reportería.';
COMMENT ON COLUMN ofertas_producto.precio_order_bump IS
  'Precio promocional cobrado SOLO cuando la oferta se acepta como Order Bump en el checkout. NULL = no se ofrece como bump (cae a precio_normal).';

-- Backfill: lo que hoy vive en `precio` es el precio normal de la oferta...
UPDATE ofertas_producto SET precio_normal = precio WHERE precio_normal IS NULL;
-- ...salvo en las que ya estaban configuradas como order bump, donde ese
-- número es en realidad el precio promocional (y también queda de normal,
-- que es el único dato de referencia que existe para ellas hoy).
UPDATE ofertas_producto SET precio_order_bump = precio
  WHERE precio_order_bump IS NULL AND estrategia = 'order_bump';

ALTER TABLE ofertas_producto ALTER COLUMN precio_normal SET DEFAULT 0;
ALTER TABLE ofertas_producto ALTER COLUMN precio_normal SET NOT NULL;

-- 3) Trazabilidad de la venta: de qué canal salió cada línea del pedido.
--    Snapshot, no un JOIN contra ofertas_producto — la oferta se puede
--    editar o dar de baja después sin que el pedido histórico cambie de
--    significado (mismo criterio que oferta_codigo/oferta_nombre).
ALTER TABLE envio_items
  ADD COLUMN IF NOT EXISTS origen_venta VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS precio_normal INTEGER;

COMMENT ON COLUMN envio_items.origen_venta IS
  'Canal por el que se vendió esta línea: normal | order_bump | upsell | combo. Snapshot al momento de la venta.';
COMMENT ON COLUMN envio_items.precio_normal IS
  'Precio unitario que habría tenido esta línea por el canal normal. Contra precio_unitario da el descuento concedido por el bump.';

-- Backfill de ventas históricas desde la estrategia que tenía la oferta.
UPDATE envio_items ei
   SET origen_venta = op.estrategia::text
  FROM ofertas_producto op
 WHERE ei.oferta_id = op.id
   AND ei.origen_venta = 'normal'
   AND op.estrategia::text <> 'normal';

CREATE INDEX IF NOT EXISTS envio_items_origen_venta_idx ON envio_items (origen_venta);

COMMIT;

-- Migración: agregar precio_ancla a landing_items
-- Ejecutar manualmente en la base de datos

ALTER TABLE landing_items
  ADD COLUMN IF NOT EXISTS precio_ancla INTEGER DEFAULT NULL
  COMMENT 'Precio tachado configurado por el usuario para este item en esta landing';

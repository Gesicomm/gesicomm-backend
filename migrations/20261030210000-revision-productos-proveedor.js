'use strict';

/**
 * Moderación del catálogo que sube un proveedor por API.
 *
 * Nadie puede publicar mercadería en Gesicom sin que un administrador la
 * mire primero. Un producto que entra por una API Key de proveedor queda
 * `estado_revision = 'pendiente'` Y `activo = false`: lo segundo es lo que
 * de verdad lo mantiene fuera de todos lados (Mi catálogo, las landings,
 * el feed de Meta y la tienda pública ya filtran por `activo`), así que no
 * hace falta sumar un filtro nuevo a cada consulta — y no hay forma de que
 * se escape por una que se nos haya pasado. `estado_revision` es lo que
 * separa "esperando revisión" de "dado de baja", que es lo que necesita la
 * cola del administrador.
 *
 * Todo lo que ya existe queda en 'aprobado': esto no esconde nada de lo que
 * hay cargado hoy.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`ALTER TABLE productos
        ADD COLUMN IF NOT EXISTS estado_revision VARCHAR(12) NOT NULL DEFAULT 'aprobado'
          CHECK (estado_revision IN ('pendiente', 'aprobado', 'rechazado')),
        ADD COLUMN IF NOT EXISTS revision_nota TEXT,
        ADD COLUMN IF NOT EXISTS revisado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ`, { transaction });
      // La cola del administrador pregunta siempre por lo pendiente: índice
      // parcial, que es lo único que se consulta y pesa casi nada.
      await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS productos_estado_revision_pendiente
        ON productos (proveedor_id, created_at DESC)
        WHERE estado_revision <> 'aprobado'`, { transaction });
    });
  },
  async down() {
    throw new Error('La reversión perdería las decisiones de revisión ya tomadas sobre el catálogo de proveedores.');
  },
};

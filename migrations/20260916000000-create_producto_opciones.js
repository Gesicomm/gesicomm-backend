'use strict';

/**
 * Modelo de Opciones/Valores tipo Shopify para variantes de producto.
 *
 * producto_opciones/producto_opcion_valores existen para que el admin defina
 * ejes de variación (Color, RAM...) con sus valores, y el sistema genere las
 * combinaciones. producto_variantes NO cambia: sigue siendo la entidad
 * comercial real (nombre, sku_variante, stocks, precio_diferencial, activo).
 * producto_variante_valores es la tabla puente que dice qué combinación de
 * valores forma cada variante.
 *
 * inquilino_id solo en producto_opciones (hija directa de productos, mismo
 * criterio que producto_variantes/producto_imagenes). Los valores y la tabla
 * puente son nietos/bridge y siempre se acceden vía join.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS producto_opciones (
        id SERIAL PRIMARY KEY,
        inquilino_id INTEGER NOT NULL REFERENCES inquilinos(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        orden INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_producto_opciones_producto_nombre UNIQUE (producto_id, nombre)
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_producto_opciones_producto ON producto_opciones (producto_id);
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS producto_opcion_valores (
        id SERIAL PRIMARY KEY,
        opcion_id INTEGER NOT NULL REFERENCES producto_opciones(id) ON DELETE CASCADE,
        valor VARCHAR(100) NOT NULL,
        orden INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_producto_opcion_valores_opcion_valor UNIQUE (opcion_id, valor)
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_producto_opcion_valores_opcion ON producto_opcion_valores (opcion_id);
    `);

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS producto_variante_valores (
        id SERIAL PRIMARY KEY,
        variante_id INTEGER NOT NULL REFERENCES producto_variantes(id) ON DELETE CASCADE,
        opcion_valor_id INTEGER NOT NULL REFERENCES producto_opcion_valores(id) ON DELETE CASCADE,
        CONSTRAINT uq_producto_variante_valores UNIQUE (variante_id, opcion_valor_id)
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_producto_variante_valores_variante ON producto_variante_valores (variante_id);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_producto_variante_valores_opcion_valor ON producto_variante_valores (opcion_valor_id);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS producto_variante_valores;');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS producto_opcion_valores;');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS producto_opciones;');
  }
};

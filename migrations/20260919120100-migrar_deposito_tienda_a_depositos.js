'use strict';

/**
 * Copia el depósito único que ya tenía cada Tienda (columnas deposito_* de
 * la migración 20260912150000) como primer registro "Principal" en la
 * tabla depositos nueva. No borra ni toca las columnas de Tienda: quedan
 * como semilla heredada (ver panel Mi Tienda → Depósito).
 *
 * Solo migra tiendas con dirección cargada (deposito_direccion no vacío),
 * porque direccion/ciudad son NOT NULL en depositos.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      INSERT INTO depositos (usuario_id, nombre, departamento, ciudad, direccion, referencia, telefono_contacto, activo, created_at, updated_at)
      SELECT
        t.usuario_id,
        'Principal',
        t.deposito_departamento,
        COALESCE(NULLIF(TRIM(t.deposito_ciudad), ''), 'Sin especificar'),
        t.deposito_direccion,
        t.deposito_referencia,
        t.deposito_telefono,
        true,
        NOW(),
        NOW()
      FROM tiendas t
      WHERE t.deposito_direccion IS NOT NULL
        AND TRIM(t.deposito_direccion) <> ''
        AND NOT EXISTS (SELECT 1 FROM depositos d WHERE d.usuario_id = t.usuario_id);
    `);
  },

  async down(queryInterface, Sequelize) {
    // No reversible de forma segura: borraría depósitos que el usuario ya
    // pudo haber editado o usado. No-op intencional.
  },
};

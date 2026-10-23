'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      for (const [ruta, nombre, mensual, orden] of [['una-ruta', 'Una ruta', 297000, 10], ['ambas-rutas', 'Ambas rutas', 397000, 20]]) {
        for (const periodicidad of ['mensual', 'anual']) {
          await queryInterface.sequelize.query(`INSERT INTO planes
            (codigo, nombre, resumen, precio, moneda, periodicidad, equivale_plan, features, etiqueta, cta, destacado, orden, activo, created_at, updated_at)
            VALUES (:codigo, :nombre, :resumen, :precio, 'PYG', :periodicidad, 'pago', :features, 'Lanzamiento', 'Contratar', :destacado, :orden, true, NOW(), NOW())
            ON CONFLICT (codigo) DO NOTHING`, { replacements: {
            codigo: `${ruta}-${periodicidad}`, nombre: `${nombre} · ${periodicidad === 'anual' ? 'Anual' : 'Mensual'}`,
            resumen: ruta === 'una-ruta' ? 'E-commerce de productos físicos o marca personal.' : 'Una tienda de productos físicos y una marca personal.',
            precio: mensual * (periodicidad === 'anual' ? 10 : 1), periodicidad,
            features: JSON.stringify([ruta === 'una-ruta' ? 'Herramientas de la ruta elegida' : 'Ambas rutas de negocio activas', 'Tutoriales técnicos del sistema', 'Soporte técnico por WhatsApp en horario laboral']),
            destacado: ruta === 'ambas-rutas', orden: orden + (periodicidad === 'anual' ? 1 : 0),
          }, transaction });
        }
      }
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query("UPDATE planes SET activo = false WHERE codigo IN ('una-ruta-mensual','una-ruta-anual','ambas-rutas-mensual','ambas-rutas-anual')");
  },
};

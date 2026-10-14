// Plantilla editable del mensaje de WhatsApp que se ofrece enviar al
// confirmar un pedido (pedido del usuario, 2026-10-14): "tu pedido ha sido
// confirmado, lo vamos a preparar ahora" con placeholders {cliente}, {pedido},
// {producto} y {total}. Mismo patrón que mensaje_contacto / mensaje_consulta_general
// (ver tienda.service.js → camposEditables).
//
// Solo agrega una columna opcional: no toca ninguna tienda existente. Es
// idempotente (se puede correr dos veces sin error).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabla = await queryInterface.describeTable('tiendas');
    if (!tabla.mensaje_confirmacion_pedido) {
      await queryInterface.addColumn('tiendas', 'mensaje_confirmacion_pedido', {
        type: Sequelize.STRING(300),
        allowNull: true,
        comment: 'Plantilla de WhatsApp para confirmar un pedido. Soporta {cliente}, {pedido}, {producto} y {total}.',
      });
    }
  },

  async down(queryInterface) {
    const tabla = await queryInterface.describeTable('tiendas');
    if (tabla.mensaje_confirmacion_pedido) await queryInterface.removeColumn('tiendas', 'mensaje_confirmacion_pedido');
  },
};

// Correo del comprador y su permiso para recibir promociones, en el pedido.
//
// El checkout de la tienda pide el correo (obligatorio con pago anticipado:
// ahí llega el comprobante de PagoPar) y ofrece una casilla para recibir
// promociones. Hasta acá los dos se guardaban como texto dentro de
// `observaciones`, que sirve para leerlos pero no para filtrar ni exportar.
//
// Solo agrega columnas opcionales: no toca ningún pedido existente. Es
// idempotente (se puede correr dos veces sin error).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabla = await queryInterface.describeTable('envios');
    if (!tabla.email) {
      await queryInterface.addColumn('envios', 'email', {
        type: Sequelize.STRING(160),
        allowNull: true,
        comment: 'Correo del comprador. Obligatorio en el checkout con pago anticipado (comprobante de la pasarela).',
      });
    }
    if (!tabla.acepta_promociones) {
      await queryInterface.addColumn('envios', 'acepta_promociones', {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        comment: 'El comprador tildó recibir promociones por correo. NULL = pedido anterior o sin correo: nunca se le preguntó.',
      });
    }
  },

  async down(queryInterface) {
    const tabla = await queryInterface.describeTable('envios');
    if (tabla.acepta_promociones) await queryInterface.removeColumn('envios', 'acepta_promociones');
    if (tabla.email) await queryInterface.removeColumn('envios', 'email');
  },
};

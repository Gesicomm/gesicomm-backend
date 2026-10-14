// Datos del navegador que compró, guardados en el pedido para el Purchase de
// la Conversions API de Meta cuando el pago llega más tarde.
//
// Con contra entrega el Purchase sale en el mismo request del checkout, con
// el navegador a mano. Con PagoPar sale recién cuando PagoPar confirma el
// pago (webhook o consulta), y ahí ya no hay navegador: la compra le llegaba
// a Meta sin user agent, sin URL, sin IP y sin fbc/fbp, o sea sin forma de
// asociarla al clic del anuncio.
//
// Solo agrega una columna opcional: no toca ningún pedido existente. Es
// idempotente (se puede correr dos veces sin error).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabla = await queryInterface.describeTable('envios');
    if (!tabla.tracking_contexto) {
      await queryInterface.addColumn('envios', 'tracking_contexto', {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Contexto del navegador al crear el pedido (ip, user agent, fbc, fbp, url, content_ids) para el Purchase de Meta CAPI de un pago confirmado después. NULL = pedido sin pago diferido o anterior a esta columna.',
      });
    }
  },

  async down(queryInterface) {
    const tabla = await queryInterface.describeTable('envios');
    if (tabla.tracking_contexto) await queryInterface.removeColumn('envios', 'tracking_contexto');
  },
};

// Clasificación de la devolución: "justificada" o "injustificada" (pedido
// del usuario, 2026-10-14). Se carga en el modal de Registrar devolución y
// sirve para identificar, cruzando por teléfono, si un cliente que vuelve a
// comprar ya devolvió sin motivo antes — ver listEnviosPaginados
// (adjuntarReputacionCliente) y la columna Cliente en Recuperación.
//
// Solo agrega una columna opcional: no toca ningún pedido existente. Es
// idempotente (se puede correr dos veces sin error).
module.exports = {
  async up(queryInterface, Sequelize) {
    const tabla = await queryInterface.describeTable('envios');
    if (!tabla.motivo_devolucion) {
      await queryInterface.addColumn('envios', 'motivo_devolucion', {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: '"justificada" o "injustificada" — se carga al registrar la devolución (ver DevolucionModal). NULL = pedido sin devolución o anterior a esta clasificación.',
      });
    }
  },

  async down(queryInterface) {
    const tabla = await queryInterface.describeTable('envios');
    if (tabla.motivo_devolucion) await queryInterface.removeColumn('envios', 'motivo_devolucion');
  },
};

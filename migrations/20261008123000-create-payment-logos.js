'use strict';

const CATALOGO_LOGOS_PAGO = [
  { clave: 'deposito_bancario', grupo: 'bancario', nombre: 'Deposito bancario', logo_url: '/payment-logos/deposito-bancario.webp', orden: 10 },
  { clave: 'transferencia_bancaria', grupo: 'bancario', nombre: 'Transferencia bancaria', logo_url: '/payment-logos/transferencia-bancaria.webp', orden: 20 },
  { clave: 'visa', grupo: 'tarjetas', nombre: 'Visa', logo_url: '/payment-logos/visa.webp', orden: 100 },
  { clave: 'mastercard', grupo: 'tarjetas', nombre: 'Mastercard', logo_url: '/payment-logos/mastercard.webp', orden: 110 },
  { clave: 'american_express', grupo: 'tarjetas', nombre: 'American Express', logo_url: '/payment-logos/american-express.webp', orden: 120 },
  { clave: 'diners_club', grupo: 'tarjetas', nombre: 'Diners Club', logo_url: '/payment-logos/diners-club.webp', orden: 130 },
  { clave: 'bancard', grupo: 'tarjetas', nombre: 'Bancard', logo_url: '/payment-logos/bancard.webp', orden: 140 },
  { clave: 'credicheck', grupo: 'bocas', nombre: 'Credicheck', logo_url: '/payment-logos/credicheck.webp', orden: 200 },
  { clave: 'cabal', grupo: 'tarjetas', nombre: 'Cabal', logo_url: '/payment-logos/cabal.webp', orden: 210 },
  { clave: 'panal', grupo: 'bocas', nombre: 'Panal', logo_url: '/payment-logos/panal.webp', orden: 220 },
  { clave: 'discover', grupo: 'tarjetas', nombre: 'Discover', logo_url: '/payment-logos/discover.webp', orden: 230 },
  { clave: 'jcb', grupo: 'tarjetas', nombre: 'JCB', logo_url: '/payment-logos/jcb.webp', orden: 240 },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payment_logos', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      clave: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      grupo: { type: Sequelize.STRING(60), allowNull: false },
      nombre: { type: Sequelize.STRING(120), allowNull: false },
      logo_url: { type: Sequelize.STRING(700), allowNull: false },
      orden: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE },
      updated_at: { allowNull: false, type: Sequelize.DATE },
    });

    await queryInterface.createTable('payment_logo_visibilities', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      payment_logo_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'payment_logos', key: 'id' },
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      tienda_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'tiendas', key: 'id' },
        onDelete: 'CASCADE',
      },
      landing_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'landings', key: 'id' },
        onDelete: 'CASCADE',
      },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE },
      updated_at: { allowNull: false, type: Sequelize.DATE },
    });

    await queryInterface.addIndex('payment_logo_visibilities', ['payment_logo_id', 'usuario_id'], {
      name: 'payment_logo_visibilities_logo_usuario_unique',
      unique: true,
      where: { usuario_id: { [Sequelize.Op.ne]: null }, tienda_id: null, landing_id: null },
    });
    await queryInterface.addIndex('payment_logo_visibilities', ['payment_logo_id', 'tienda_id'], {
      name: 'payment_logo_visibilities_logo_tienda_unique',
      unique: true,
      where: { tienda_id: { [Sequelize.Op.ne]: null }, landing_id: null },
    });
    await queryInterface.addIndex('payment_logo_visibilities', ['payment_logo_id', 'landing_id'], {
      name: 'payment_logo_visibilities_logo_landing_unique',
      unique: true,
      where: { landing_id: { [Sequelize.Op.ne]: null } },
    });

    const now = new Date();
    await queryInterface.bulkInsert('payment_logos', CATALOGO_LOGOS_PAGO.map(logo => ({
      ...logo,
      activo: true,
      created_at: now,
      updated_at: now,
    })));
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_logo_visibilities');
    await queryInterface.dropTable('payment_logos');
  },
};

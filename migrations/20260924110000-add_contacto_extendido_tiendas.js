'use strict';

/**
 * Agrega campos de contacto extendido a la tabla tiendas:
 * - nombre_contacto: nombre de la persona o empresa de contacto visible al público
 * - canal_contacto: canal preferido (whatsapp | email | telefono | instagram)
 * - email_contacto: email público de contacto
 * - instagram: handle de Instagram (sin @)
 * - facebook: URL o handle de Facebook
 * - twitter: handle de Twitter/X (sin @)
 * - tiktok: handle de TikTok (sin @)
 * - youtube: URL del canal de YouTube
 * - direccion_publica: dirección física visible al público (≠ deposito_direccion que es para logística)
 * - ciudad_publica: ciudad visible al público
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tiendas', 'nombre_contacto', {
      type: Sequelize.STRING(150),
      allowNull: true,
      comment: 'Nombre visible al público en la sección de contacto.',
    });
    await queryInterface.addColumn('tiendas', 'canal_contacto', {
      type: Sequelize.STRING(30),
      allowNull: true,
      defaultValue: 'whatsapp',
      comment: 'Canal preferido de contacto: whatsapp, email, telefono, instagram.',
    });
    await queryInterface.addColumn('tiendas', 'email_contacto', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('tiendas', 'instagram', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Handle de Instagram sin @.',
    });
    await queryInterface.addColumn('tiendas', 'facebook', {
      type: Sequelize.STRING(200),
      allowNull: true,
      comment: 'Handle o URL de página de Facebook.',
    });
    await queryInterface.addColumn('tiendas', 'twitter', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Handle de Twitter/X sin @.',
    });
    await queryInterface.addColumn('tiendas', 'tiktok', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Handle de TikTok sin @.',
    });
    await queryInterface.addColumn('tiendas', 'youtube', {
      type: Sequelize.STRING(200),
      allowNull: true,
      comment: 'URL del canal de YouTube.',
    });
    await queryInterface.addColumn('tiendas', 'direccion_publica', {
      type: Sequelize.STRING(300),
      allowNull: true,
      comment: 'Dirección física visible al público (distinta de deposito_direccion).',
    });
    await queryInterface.addColumn('tiendas', 'ciudad_publica', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Ciudad o localidad visible al público.',
    });
  },

  async down(queryInterface) {
    for (const col of [
      'nombre_contacto', 'canal_contacto', 'email_contacto',
      'instagram', 'facebook', 'twitter', 'tiktok', 'youtube',
      'direccion_publica', 'ciudad_publica',
    ]) {
      await queryInterface.removeColumn('tiendas', col);
    }
  },
};

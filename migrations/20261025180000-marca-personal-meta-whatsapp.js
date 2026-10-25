'use strict';
// WhatsApp en las conexiones de Marca Personal: amplía el control de plataforma
// y agrega cuenta_id (la cuenta de WhatsApp Business del número conectado).
// Aditiva e idempotente; no modifica filas existentes.
module.exports={
 async up(queryInterface){
  await queryInterface.sequelize.transaction(async transaction=>{
   await queryInterface.sequelize.query('ALTER TABLE marca_personal_meta_conexiones DROP CONSTRAINT IF EXISTS marca_personal_meta_conexiones_plataforma_check',{transaction});
   await queryInterface.sequelize.query(`ALTER TABLE marca_personal_meta_conexiones ADD CONSTRAINT marca_personal_meta_conexiones_plataforma_check CHECK (plataforma IN ('instagram','facebook','whatsapp'))`,{transaction});
   await queryInterface.sequelize.query('ALTER TABLE marca_personal_meta_conexiones ADD COLUMN IF NOT EXISTS cuenta_id VARCHAR(64)',{transaction});
  });
 },
 async down(){throw new Error('La reversión conserva las conexiones de WhatsApp; no se revierte automáticamente.');}
};

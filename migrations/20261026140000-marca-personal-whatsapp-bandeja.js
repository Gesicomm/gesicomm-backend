'use strict';
// Sólo almacenamiento de la bandeja de Gesicom; no toca Supabase ni los chats del teléfono.
module.exports={
 async up(q){await q.sequelize.transaction(async transaction=>{
  await q.sequelize.query(`CREATE TABLE IF NOT EXISTS marca_personal_whatsapp_mensajes (
   id SERIAL PRIMARY KEY, account_id VARCHAR(80) NOT NULL, phone_id VARCHAR(64) NOT NULL,
   external_id VARCHAR(300), solicitud VARCHAR(64), contacto VARCHAR(15) NOT NULL,
   nombre VARCHAR(200), direccion VARCHAR(10) NOT NULL CHECK(direccion IN ('entrante','saliente')),
   tipo VARCHAR(30) NOT NULL, texto TEXT NOT NULL DEFAULT '', estado VARCHAR(20) NOT NULL,
   estado_fecha TIMESTAMPTZ, fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   UNIQUE(account_id,phone_id,external_id), UNIQUE(account_id,phone_id,solicitud)
  )`,{transaction});
  await q.sequelize.query('CREATE INDEX IF NOT EXISTS mp_wa_contacto_fecha ON marca_personal_whatsapp_mensajes(account_id,phone_id,contacto,fecha DESC,id DESC)',{transaction});
 });},
 async down(){throw Error('Se conserva el historial; no se borran mensajes automáticamente.');}
};

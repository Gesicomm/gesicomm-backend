'use strict';
// Conexiones de Instagram y Facebook de Marca Personal con la app de Gesicom.
// Aditiva e idempotente: dos tablas nuevas, no modifica ninguna existente.
module.exports={
 async up(queryInterface){
  await queryInterface.sequelize.transaction(async transaction=>{
   await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS marca_personal_meta_conexiones (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(80) NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    plataforma VARCHAR(20) NOT NULL CHECK (plataforma IN ('instagram','facebook')),
    external_id VARCHAR(64) NOT NULL,
    meta_user_id VARCHAR(64),
    nombre VARCHAR(200),
    username VARCHAR(200),
    access_token TEXT NOT NULL,
    token_expira TIMESTAMPTZ,
    permisos JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mp_meta_una_por_marca UNIQUE (account_id, plataforma),
    CONSTRAINT mp_meta_cuenta_unica UNIQUE (plataforma, external_id)
   )`,{transaction});
   await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS mp_meta_conexiones_meta_user ON marca_personal_meta_conexiones (meta_user_id)',{transaction});
   await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS marca_personal_meta_publicaciones (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(80) NOT NULL,
    conexion_id INTEGER NOT NULL REFERENCES marca_personal_meta_conexiones(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    plataforma VARCHAR(20) NOT NULL CHECK (plataforma IN ('instagram','facebook')),
    formato VARCHAR(20) NOT NULL CHECK (formato IN ('imagen','carrusel','reel','texto')),
    texto TEXT NOT NULL DEFAULT '',
    medios JSONB NOT NULL DEFAULT '[]'::jsonb,
    estado VARCHAR(20) NOT NULL DEFAULT 'procesando' CHECK (estado IN ('procesando','publicada','error')),
    contenedor_id VARCHAR(64),
    external_id VARCHAR(64),
    permalink TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,{transaction});
   await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS mp_meta_publicaciones_cuenta ON marca_personal_meta_publicaciones (account_id, created_at DESC)',{transaction});
  });
 },
 async down(){throw new Error('La reversión conserva las conexiones y publicaciones; no borrar estas tablas automáticamente.');}
};

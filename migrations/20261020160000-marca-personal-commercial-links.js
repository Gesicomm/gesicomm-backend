'use strict';
module.exports={
 async up(queryInterface){
  await queryInterface.sequelize.transaction(async transaction=>{
   await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS marca_personal_commercial_links (
    id SERIAL PRIMARY KEY,
    account_id VARCHAR(80) NOT NULL UNIQUE,
    creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    links JSONB NOT NULL DEFAULT '[]'::jsonb,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT marca_personal_links_array CHECK (jsonb_typeof(links) = 'array')
   )`,{transaction});
  });
 },
 async down(){throw new Error('La reversión conserva los enlaces guardados; no borrar esta tabla automáticamente.');}
};

'use strict';
// Prueba aislada: nunca lee .env ni acepta el puerto de la base de producción.
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const {Sequelize,DataTypes,QueryTypes}=require('sequelize');
const db=new Sequelize('postgres','postgres','',{host:'127.0.0.1',port:55439,dialect:'postgres',logging:false});
const migration=require('../migrations/20261029120000-catalogo-cuatro-planes');
const {CODIGOS}=require('../src/utils/catalogoPlanes');
async function run(){
  const [[existing]]=await db.query("SELECT to_regclass('public.planes') AS tabla");
  assert.equal(existing.tabla,null,'Solo se ejecuta en una base temporal vacía.');
  await db.query(`
    CREATE TABLE roles(id SERIAL PRIMARY KEY,nombre TEXT);
    CREATE TABLE usuarios(id SERIAL PRIMARY KEY,rol_id INTEGER REFERENCES roles(id),correo_electronico TEXT,nombre TEXT,telefono TEXT,plan TEXT,activo BOOLEAN DEFAULT true,"createdAt" TIMESTAMPTZ DEFAULT NOW(),"updatedAt" TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE planes(id SERIAL PRIMARY KEY,codigo VARCHAR(50) UNIQUE,nombre TEXT,acceso_rutas TEXT,precio INTEGER,moneda TEXT,periodicidad TEXT,equivale_plan TEXT,resumen TEXT,features JSON,etiqueta TEXT,cta TEXT,destacado BOOLEAN,orden INTEGER,activo BOOLEAN,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE suscripciones(id SERIAL PRIMARY KEY,plan_id INTEGER REFERENCES planes(id),usuario_id INTEGER REFERENCES usuarios(id),email TEXT,nombre TEXT,telefono TEXT,estado TEXT,precio_pagado INTEGER,periodo_inicio TIMESTAMPTZ,periodo_fin TIMESTAMPTZ,ruta_acceso TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE codigos_prueba(id SERIAL PRIMARY KEY,plan_id INTEGER REFERENCES planes(id),usado_en TIMESTAMPTZ,activo BOOLEAN,updated_at TIMESTAMPTZ);
    CREATE TABLE pagos_suscripcion(id SERIAL PRIMARY KEY,suscripcion_id INTEGER REFERENCES suscripciones(id),monto INTEGER,referencia TEXT);
    INSERT INTO roles(nombre) VALUES('usuario'),('administrador'),('colaborador');
    INSERT INTO planes(codigo,nombre,acceso_rutas,precio,moneda,periodicidad,equivale_plan,features,activo,destacado,orden) VALUES
      ('free','Free','ambas',0,'PYG','mensual','free','[]',true,false,1),
      ('starter','Starter','ambas',47,'USD','mensual','pago','[]',true,false,2),
      ('founders','Miembros Fundadores','ambas',297000,'PYG','mensual','pago','[]',true,true,3),
      ('una-ruta-mensual','Una ruta editada','elegir',333000,'PYG','mensual','pago','["Precio editado"]',true,false,4);
    INSERT INTO usuarios(rol_id,correo_electronico,nombre,plan) SELECT 1,'persona'||id||'@example.test','Persona '||id,CASE WHEN id IN(1,2,3,6,7,8) THEN 'pago' ELSE 'free' END FROM generate_series(1,10) id;
    UPDATE usuarios SET rol_id=2,plan='pago' WHERE id=9;
    UPDATE usuarios SET rol_id=3,plan='pago' WHERE id=10;
    INSERT INTO suscripciones(plan_id,usuario_id,email,estado,precio_pagado,periodo_inicio,periodo_fin,ruta_acceso) VALUES
      (3,1,'persona1@example.test','activa',297000,NOW()-INTERVAL '10 days',NOW()+INTERVAL '20 days','ambas'),
      (2,2,'persona2@example.test','vencida',47,NOW()-INTERVAL '90 days',NOW()-INTERVAL '60 days','ambas'),
      (4,3,'persona3@example.test','activa',333000,NOW(),NOW()+INTERVAL '30 days','personal'),
      (1,5,'persona5@example.test','activa',0,NOW(),NULL,'ambas'),
      (3,7,'persona7@example.test','pendiente_pago',297000,NULL,NULL,NULL),
      (3,8,'persona8@example.test','cancelada',297000,NOW()-INTERVAL '50 days',NOW()-INTERVAL '20 days','ambas');
    INSERT INTO pagos_suscripcion(suscripcion_id,monto,referencia) VALUES(1,297000,'HISTORICO-1'),(2,47,'HISTORICO-2');
    INSERT INTO codigos_prueba(plan_id,activo) VALUES(3,true),(4,true);
  `);
  const snapshots=await db.query('SELECT id,plan_id,usuario_id,precio_pagado,estado,periodo_inicio,periodo_fin FROM suscripciones ORDER BY id',{type:QueryTypes.SELECT});
  const pagos=await db.query('SELECT * FROM pagos_suscripcion ORDER BY id',{type:QueryTypes.SELECT});
  const resultado=await migration.up(db.getQueryInterface(),Sequelize);
  assert.equal(resultado.accesos_permanentes,5);
  const rows=await db.query('SELECT usuario_id,plan_id,ruta_acceso,periodo_fin,acceso_permanente FROM suscripciones WHERE acceso_permanente ORDER BY usuario_id',{type:QueryTypes.SELECT});
  assert.deepEqual(rows.map(s=>s.usuario_id),[1,2,5,6,8]);
  for(const row of rows){assert.equal(row.ruta_acceso,'ambas');assert.equal(row.periodo_fin,null);}
  assert.deepEqual(await db.query('SELECT id,plan_id,usuario_id,precio_pagado,estado,periodo_inicio,periodo_fin FROM suscripciones WHERE NOT acceso_permanente ORDER BY id',{type:QueryTypes.SELECT}),snapshots);
  assert.deepEqual(await db.query('SELECT * FROM pagos_suscripcion ORDER BY id',{type:QueryTypes.SELECT}),pagos);
  const active=await db.query('SELECT codigo FROM planes WHERE activo ORDER BY orden',{type:QueryTypes.SELECT});
  assert.deepEqual(active.map(p=>p.codigo),CODIGOS);
  const [[custom]]=await db.query("SELECT precio,features FROM planes WHERE codigo='una-ruta-mensual'");
  assert.equal(custom.precio,333000);assert.deepEqual(custom.features,['Precio editado']);
  assert.deepEqual(await migration.up(db.getQueryInterface(),Sequelize),resultado);
  assert.equal((await db.query('SELECT id FROM suscripciones WHERE acceso_permanente',{type:QueryTypes.SELECT})).length,5);
  // Una edición posterior no se pisa al reiniciar el servidor.
  await db.query("UPDATE planes SET activo=false,precio=444000 WHERE codigo='una-ruta-anual'");
  await migration.up(db.getQueryInterface(),Sequelize);
  const [[edited]]=await db.query("SELECT activo,precio FROM planes WHERE codigo='una-ruta-anual'");
  assert.equal(edited.activo,false);assert.equal(edited.precio,444000);
  const Plan=db.define('Plan',{id:{type:DataTypes.INTEGER,primaryKey:true},codigo:DataTypes.STRING,nombre:DataTypes.STRING,acceso_rutas:DataTypes.STRING,equivale_plan:DataTypes.STRING},{tableName:'planes',timestamps:false});
  const Suscripcion=db.define('Suscripcion',{id:{type:DataTypes.INTEGER,primaryKey:true},usuario_id:DataTypes.INTEGER,plan_id:DataTypes.INTEGER,estado:DataTypes.STRING,periodo_inicio:DataTypes.DATE,periodo_fin:DataTypes.DATE,acceso_permanente:DataTypes.BOOLEAN,ruta_acceso:DataTypes.STRING,created_at:DataTypes.DATE},{tableName:'suscripciones',timestamps:false});
  Suscripcion.belongsTo(Plan,{foreignKey:'plan_id'});
  const mp=require.resolve('../src/models');require.cache[mp]={id:mp,filename:mp,loaded:true,exports:{Suscripcion,Plan}};
  const Service=require('../src/services/suscripcion.service');
  const vigente=await Service.suscripcionActivaDeUsuario(1);
  assert.equal(vigente.acceso_permanente,true);
  assert.deepEqual(require('../src/utils/rutasPlan').rutasDeSuscripcion(vigente),{fisico:true,personal:true});
  assert.equal(Service.serializarSuscripcion(vigente).plan.nombre,'Ambas rutas · Acceso permanente');
  console.log('OK: cuatro planes, precios preservados, migración de accesos legados, exclusión de compras impagas y cuentas nuevas, historial intacto, idempotencia y acceso permanente real.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());

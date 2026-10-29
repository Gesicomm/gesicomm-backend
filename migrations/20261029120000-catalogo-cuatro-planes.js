'use strict';
const {PLANES,CODIGOS}=require('../src/utils/catalogoPlanes');
const VERSION='catalogo-cuatro-planes-20261029';

module.exports={
  async up(qi,Sequelize){
    return qi.sequelize.transaction(async transaction=>{
      const options={transaction};
      // Una sola ejecución incluso si arrancan dos instancias del backend.
      await qi.sequelize.query('SELECT pg_advisory_xact_lock(20261029, 4)',options);
      await qi.sequelize.query(`CREATE TABLE IF NOT EXISTS migraciones_catalogo_planes (
        id SERIAL PRIMARY KEY, version VARCHAR(80) NOT NULL UNIQUE,
        resumen JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,options);
      const [aplicada]=await qi.sequelize.query('SELECT resumen FROM migraciones_catalogo_planes WHERE version=:version',{...options,replacements:{version:VERSION}});
      if(aplicada.length)return aplicada[0].resumen;
      const schema=await qi.describeTable('suscripciones',options);
      if(!schema.acceso_permanente)await qi.addColumn('suscripciones','acceso_permanente',{type:Sequelize.BOOLEAN,allowNull:false,defaultValue:false},options);
      if(!schema.origen_plan_anterior_id)await qi.addColumn('suscripciones','origen_plan_anterior_id',{type:Sequelize.INTEGER,allowNull:true,references:{model:'planes',key:'id'},onDelete:'RESTRICT'},options);
      await qi.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_permanentes_usuario ON suscripciones(usuario_id) WHERE acceso_permanente = true',options);
      for(const plan of PLANES){
        await qi.sequelize.query(`INSERT INTO planes
          (codigo,nombre,acceso_rutas,precio,moneda,periodicidad,equivale_plan,resumen,features,etiqueta,cta,destacado,orden,activo,created_at,updated_at)
          VALUES (:codigo,:nombre,:acceso_rutas,:precio,:moneda,:periodicidad,'pago',:resumen,:features,NULL,:cta,:destacado,:orden,true,NOW(),NOW())
          ON CONFLICT(codigo) DO UPDATE SET nombre=EXCLUDED.nombre,acceso_rutas=EXCLUDED.acceso_rutas,
            periodicidad=EXCLUDED.periodicidad,equivale_plan='pago',activo=true,orden=EXCLUDED.orden,updated_at=NOW()`,
          {...options,replacements:{...plan,features:JSON.stringify(plan.features)}});
      }
      // Cada acceso es una suscripción nueva a ambas rutas, sin reemplazar
      // suscripciones originales ni snapshots de compras, precios o pagos.
      const [otorgadas]=await qi.sequelize.query(`INSERT INTO suscripciones
        (plan_id,usuario_id,email,nombre,telefono,estado,precio_pagado,periodo_inicio,periodo_fin,
         ruta_acceso,acceso_permanente,origen_plan_anterior_id,created_at,updated_at)
        SELECT destino.id,u.id,u.correo_electronico,u.nombre,u.telefono,'activa',0,NOW(),NULL,
          'ambas',true,anterior.plan_id,NOW(),NOW()
        FROM usuarios u JOIN roles r ON r.id=u.rol_id
        CROSS JOIN planes destino
        LEFT JOIN LATERAL (
          SELECT s.plan_id FROM suscripciones s JOIN planes p ON p.id=s.plan_id
          WHERE s.usuario_id=u.id AND p.codigo NOT IN (:codigos)
            AND (s.estado IN ('activa','vencida') OR s.periodo_inicio IS NOT NULL)
          ORDER BY s.periodo_inicio DESC NULLS LAST,s.id DESC LIMIT 1
        ) anterior ON true
        WHERE destino.codigo='ambas-rutas-mensual' AND r.nombre='usuario'
          AND (anterior.plan_id IS NOT NULL OR (u.plan='pago' AND NOT EXISTS (SELECT 1 FROM suscripciones s WHERE s.usuario_id=u.id)))
          AND NOT EXISTS(SELECT 1 FROM suscripciones s WHERE s.usuario_id=u.id AND s.acceso_permanente=true)
        RETURNING id`,{...options,replacements:{codigos:CODIGOS}});
      await qi.sequelize.query(`UPDATE usuarios u SET plan='pago'
        WHERE EXISTS(SELECT 1 FROM suscripciones s WHERE s.usuario_id=u.id AND s.acceso_permanente=true)`,options);
      const [retirados]=await qi.sequelize.query('UPDATE planes SET activo=false,destacado=false,updated_at=NOW() WHERE codigo NOT IN (:codigos) RETURNING id',{...options,replacements:{codigos:CODIGOS}});
      await qi.sequelize.query(`UPDATE codigos_prueba SET activo=false,updated_at=NOW()
        WHERE usado_en IS NULL AND plan_id IN (SELECT id FROM planes WHERE codigo NOT IN (:codigos))`,{...options,replacements:{codigos:CODIGOS}});
      const resumen={planes_comerciales:4,planes_retirados:retirados.length,accesos_permanentes:otorgadas.length};
      await qi.sequelize.query('INSERT INTO migraciones_catalogo_planes(version,resumen) VALUES(:version,:resumen)',{...options,replacements:{version:VERSION,resumen:JSON.stringify(resumen)}});
      return resumen;
    });
  },
  async down(){throw new Error('Esta migración conserva derechos e historial. La reversión requiere una migración explícita; no se revocan accesos permanentes automáticamente.');},
};

'use strict';
module.exports = {
  async up(qi, Sequelize) {
    await qi.sequelize.transaction(async transaction => {
      const options = { transaction };
      const planes = await qi.describeTable('planes', options);
      if (!planes.acceso_rutas) {
        await qi.addColumn('planes', 'acceso_rutas', { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'elegir' }, options);
        await qi.sequelize.query("UPDATE planes SET acceso_rutas = CASE WHEN codigo LIKE 'una-ruta-%' THEN 'elegir' ELSE 'ambas' END", options);
      }
      const subscriptions = await qi.describeTable('suscripciones', options);
      if (!subscriptions.ruta_acceso) {
        await qi.addColumn('suscripciones', 'ruta_acceso', { type: Sequelize.STRING(12), allowNull: true }, options);
        await qi.sequelize.query(`UPDATE suscripciones s SET ruta_acceso = CASE
          WHEN p.acceso_rutas = 'elegir' THEN COALESCE((SELECT CASE WHEN ci.metadata->>'ruta' IN ('fisico','personal') THEN ci.metadata->>'ruta' END FROM checkout_intents ci WHERE ci.id=s.checkout_intent_id), 'fisico')
          ELSE p.acceso_rutas END FROM planes p WHERE s.plan_id=p.id`, options);
      }
      const codes = await qi.describeTable('codigos_prueba', options);
      if (!codes.ruta_acceso) {
        await qi.addColumn('codigos_prueba', 'ruta_acceso', { type: Sequelize.STRING(12), allowNull: true }, options);
        await qi.sequelize.query("UPDATE codigos_prueba c SET ruta_acceso=CASE WHEN p.acceso_rutas='elegir' THEN 'fisico' ELSE p.acceso_rutas END FROM planes p WHERE c.plan_id=p.id", options);
      }
    });
  },
  async down(qi) {
    await qi.sequelize.transaction(async transaction => {
      for (const [table, field] of [['codigos_prueba','ruta_acceso'],['suscripciones','ruta_acceso'],['planes','acceso_rutas']]) await qi.removeColumn(table, field, { transaction });
    });
  },
};

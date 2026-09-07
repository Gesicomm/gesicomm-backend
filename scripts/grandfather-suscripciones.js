'use strict';

/**
 * Le da una suscripción "heredada" a cada usuario que YA existía antes de
 * que hubiera planes y cobros, para que ninguno pierda el acceso.
 *
 * Criterio: se respeta el nivel que cada uno ya tenía en `Usuario.plan`
 * ('free' | 'pago' | null → se trata como 'free') y se le asigna el plan del
 * catálogo con ese mismo `equivale_plan`, el de menor `orden`. NO se asciende
 * a nadie de nivel: si estaba en free, queda en free.
 *
 * La suscripción queda con:
 *   estado         = 'activa'
 *   periodo_fin    = null   → sin vencimiento; es un derecho adquirido
 *   precio_pagado  = 0      → no pagó por esta vía, lo tenía de antes
 *
 * Es idempotente: si el usuario ya tiene una suscripción, se lo saltea.
 *
 * Ejecutar:
 *   node scripts/grandfather-suscripciones.js           (simulación)
 *   node scripts/grandfather-suscripciones.js --aplicar (escribe)
 */

require('dotenv').config();
const { sequelize, Usuario, Plan, Suscripcion } = require('../src/models');

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const t = await sequelize.transaction();
  try {
    const planes = await Plan.findAll({ order: [['orden', 'ASC']], transaction: t });
    if (!planes.length) {
      throw new Error('No hay planes cargados. Corré antes migrate-planes-suscripciones.js');
    }

    const planPara = (nivel) =>
      planes.find(p => p.equivale_plan === (nivel === 'pago' ? 'pago' : 'free')) || planes[0];

    const usuarios = await Usuario.findAll({
      attributes: ['id', 'nombre', 'correo_electronico', 'plan'],
      transaction: t,
    });

    const yaTienen = await Suscripcion.findAll({
      attributes: ['usuario_id'],
      where: { usuario_id: usuarios.map(u => u.id) },
      transaction: t,
    });
    const conSuscripcion = new Set(yaTienen.map(s => s.usuario_id));

    const aCrear = usuarios.filter(u => !conSuscripcion.has(u.id));

    console.log(`Usuarios totales:        ${usuarios.length}`);
    console.log(`Ya tienen suscripción:   ${conSuscripcion.size}`);
    console.log(`Se les va a crear una:   ${aCrear.length}\n`);

    const resumen = {};
    const filas = aCrear.map(u => {
      const plan = planPara(u.plan);
      resumen[plan.codigo] = (resumen[plan.codigo] || 0) + 1;
      return {
        plan_id: plan.id,
        usuario_id: u.id,
        email: u.correo_electronico,
        nombre: u.nombre,
        estado: 'activa',
        precio_pagado: 0,
        periodo_inicio: new Date(),
        periodo_fin: null,
      };
    });

    console.log('Reparto por plan:');
    Object.entries(resumen).forEach(([codigo, n]) => console.log(`  ${codigo}: ${n}`));

    if (!APLICAR) {
      console.log('\n(simulación — no se escribió nada. Volvé a correr con --aplicar)');
      await t.rollback();
      return;
    }

    if (filas.length) {
      await Suscripcion.bulkCreate(filas, { transaction: t });
    }
    await t.commit();
    console.log(`\n✓ ${filas.length} suscripciones heredadas creadas.`);
  } catch (err) {
    await t.rollback();
    console.error('\n✗ Falló, no se escribió nada:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();

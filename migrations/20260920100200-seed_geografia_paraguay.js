'use strict';

/**
 * Siembra el catálogo geográfico de Paraguay desde src/data/geografiaParaguay.js.
 *
 * Idempotente: usa ON CONFLICT DO NOTHING contra las unique de nombre
 * normalizado, así que volver a correrla agrega sólo lo que falte. Eso es
 * deliberado — la lista de distritos se va a corregir con el uso, y la forma
 * de aplicar las correcciones es editar el módulo de datos y re-ejecutar.
 *
 * El `down` NO borra las tablas (eso es de la migración de estructura) sino
 * las filas sembradas, y sólo si nada las referencia.
 */
const { DEPARTAMENTOS, PAIS, normalizar } = require('../src/data/geografiaParaguay');

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `INSERT INTO public.paises (codigo, nombre) VALUES (:codigo, :nombre)
         ON CONFLICT (codigo) DO NOTHING;`,
        { replacements: PAIS, transaction },
      );

      const [pais] = await sequelize.query(
        'SELECT id FROM public.paises WHERE codigo = :codigo',
        { replacements: { codigo: PAIS.codigo }, type: sequelize.QueryTypes.SELECT, transaction },
      );

      for (const depto of DEPARTAMENTOS) {
        await sequelize.query(
          `INSERT INTO public.departamentos (pais_id, nombre, nombre_normalizado)
           VALUES (:paisId, :nombre, :norm)
           ON CONFLICT (pais_id, nombre_normalizado) DO NOTHING;`,
          { replacements: { paisId: pais.id, nombre: depto.nombre, norm: normalizar(depto.nombre) }, transaction },
        );

        const [fila] = await sequelize.query(
          'SELECT id FROM public.departamentos WHERE pais_id = :paisId AND nombre_normalizado = :norm',
          {
            replacements: { paisId: pais.id, norm: normalizar(depto.nombre) },
            type: sequelize.QueryTypes.SELECT,
            transaction,
          },
        );

        for (const ciudad of depto.ciudades) {
          await sequelize.query(
            `INSERT INTO public.ciudades (departamento_id, nombre, nombre_normalizado)
             VALUES (:deptoId, :nombre, :norm)
             ON CONFLICT (departamento_id, nombre_normalizado) DO NOTHING;`,
            { replacements: { deptoId: fila.id, nombre: ciudad, norm: normalizar(ciudad) }, transaction },
          );
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM public.ciudades;
      DELETE FROM public.departamentos;
      DELETE FROM public.paises WHERE codigo = 'PY';
    `);
  },
};

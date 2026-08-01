const { PreguntaExamen, Examen, ModuloEducacion } = require('../src/models');

async function check() {
  const mods = await ModuloEducacion.findAll({
    include: [{
      model: Examen,
      as: 'examen',
      include: [{ model: PreguntaExamen, as: 'preguntas' }]
    }]
  });
  console.log('Modulos en DB:', JSON.stringify(mods, null, 2));
  process.exit(0);
}

check();

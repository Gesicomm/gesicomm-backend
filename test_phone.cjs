const { Envio } = require('./src/models');
const { literal } = require('sequelize');
async function run() {
  const envios = await Envio.findAll({
    attributes: [
      'telefono',
      [literal(`REGEXP_REPLACE(telefono, '[^0-9]', '', 'g')`), 'tel_norm']
    ],
    limit: 5
  });
  console.log(envios.map(e => e.toJSON()));
  process.exit(0);
}
run();

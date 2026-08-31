const db = require('./src/models');
db.sequelize.options.logging = console.log;
db.sequelize.sync({ alter: false }).then(() => {
  console.log("SYNC EXITOSO!");
  process.exit(0);
}).catch(err => {
  console.error("ERROR EN SYNC:");
  console.error(err);
  process.exit(1);
});

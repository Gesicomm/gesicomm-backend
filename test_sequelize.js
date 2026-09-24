const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('sqlite::memory:', { logging: false });

const User = sequelize.define('User', {
  name: DataTypes.STRING
});

async function test() {
  await sequelize.sync();
  try {
    const users = await User.findAll({
      where: {
        non_existent_column: 1
      }
    });
    console.log("Success! Users:", users);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();

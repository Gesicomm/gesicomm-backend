require('dotenv').config();
const { sequelize } = require('../src/models');

// Ver las categorías con slug duplicado o conflictivo
async function run() {
  try {
    const [all] = await sequelize.query('SELECT id, nombre, slug FROM categorias WHERE id >= 46 ORDER BY id;');
    console.log('Categorías a corregir:');
    all.forEach(c => console.log(`  [${c.id}] "${c.nombre}" slug="${c.slug}"`));

    // Las que quedaron sin corregir por conflicto de slug, las corregimos con slug único
    const pendientes = [
      [57, 'Hogar y organización', 'hogar-y-organizacion-raja'],
      [59, 'Informática y gaming', 'informatica-y-gaming-raja'],
      [60, 'Jardín y exteriores', 'jardin-y-exteriores-raja'],
      [58, 'Iluminación y electricidad', 'iluminacion-y-electricidad-raja'],
    ];

    for (const [id, nombre, slug] of pendientes) {
      const [r] = await sequelize.query(
        'UPDATE categorias SET nombre = $1, slug = $2, updated_at = NOW() WHERE id = $3 RETURNING id;',
        { bind: [nombre, slug, id] }
      );
      if (r.length > 0) console.log('Actualizado:', nombre);
    }

    const [final] = await sequelize.query('SELECT id, nombre, slug FROM categorias WHERE id >= 46 ORDER BY id;');
    console.log('\nEstado final:');
    final.forEach(c => console.log(`  [${c.id}] ${c.nombre}`));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await sequelize.close();
  }
}
run();

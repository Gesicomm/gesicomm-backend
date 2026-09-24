const db = require('../src/models');
const CategoriaService = require('../src/services/categoria.service');

const INQUILINO_ID = 2;

async function upsertCategoria(nombre, parent_id) {
  const existente = await db.Categoria.findOne({ where: { nombre, inquilino_id: INQUILINO_ID } });
  if (existente) { console.log('ya existe:', existente.id, nombre); return existente.id; }
  const cat = await CategoriaService.crear({ nombre, parent_id }, INQUILINO_ID);
  console.log('creada:', cat.id, nombre);
  return cat.id;
}

(async () => {
  try {
    const padre = await db.Categoria.findOne({ where: { nombre: 'Electrónica y Tecnología', inquilino_id: INQUILINO_ID } });
    const padreId = padre.id;
    const ids = {};
    ids.conectividad = await upsertCategoria('Conectividad', padreId);
    ids.audio_personal = await upsertCategoria('Auriculares y Audio Personal', padreId);
    ids.gaming = await upsertCategoria('Gaming', padreId);
    console.log('IDS:', JSON.stringify(ids, null, 2));
  } catch (e) {
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
})();

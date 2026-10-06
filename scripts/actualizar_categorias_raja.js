require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Producto, Categoria } = require('../src/models');

function toSlug(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const JSON_PATH = 'C:/Users/Martin/.gemini/antigravity/brain/f2003ff9-94e7-4c95-9618-db0495667fe1/scratch/sku_categorias.json';

async function actualizarCategorias() {
  try {
    const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

    // 1. Obtener productos Raja de la BD (SKU -> id)
    const [productosBD] = await sequelize.query('SELECT id, sku FROM productos WHERE proveedor_id = 6;');
    const skuToId = {};
    productosBD.forEach(p => { skuToId[p.sku] = p.id; });
    console.log(`Productos Raja en BD: ${productosBD.length}`);

    // 2. Categorías únicas del Excel
    const catUnicas = [...new Set(data.map(d => d.categoria).filter(Boolean))];
    console.log(`Categorías únicas en Excel: ${catUnicas.length}`, catUnicas);

    // 3. Obtener o crear cada categoría en la BD (inquilino_id = 2)
    const catMap = {}; // nombre -> id
    const [catsExistentes] = await sequelize.query('SELECT id, nombre FROM categorias WHERE inquilino_id = 2;');
    catsExistentes.forEach(c => { catMap[c.nombre] = c.id; });
    console.log(`Categorías existentes en BD: ${catsExistentes.length}`);

    for (const catNombre of catUnicas) {
      if (!catMap[catNombre]) {
        // Crear categoría nueva
        const slug = toSlug(catNombre);
        const [res] = await sequelize.query(
          'INSERT INTO categorias (nombre, slug, inquilino_id, created_at, updated_at) VALUES ($1, $2, 2, NOW(), NOW()) RETURNING id;',
          { bind: [catNombre, slug] }
        );
        catMap[catNombre] = res[0].id;
        console.log(`Categoría creada: "${catNombre}" -> id ${res[0].id}`);
      }
    }

    // 4. Cruzar SKUs y actualizar categoria_id
    let actualizados = 0;
    let noEncontrados = 0;
    for (const item of data) {
      const productoId = skuToId[item.sku];
      const categoriaId = catMap[item.categoria];
      if (!productoId) {
        noEncontrados++;
        continue;
      }
      if (!categoriaId) continue;
      await sequelize.query(
        'UPDATE productos SET categoria_id = $1, updated_at = NOW() WHERE id = $2;',
        { bind: [categoriaId, productoId] }
      );
      actualizados++;
    }

    console.log(`\n✅ Productos actualizados con categoría: ${actualizados}`);
    console.log(`⚠️  SKUs del Excel no encontrados en BD: ${noEncontrados}`);
    
    // Verificar resultado
    const [check] = await sequelize.query(
      'SELECT c.nombre AS categoria, COUNT(*) AS total FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE p.proveedor_id = 6 GROUP BY c.nombre ORDER BY total DESC;'
    );
    console.log('\nResumen por categoría:');
    check.forEach(r => console.log(`  ${r.categoria || '(sin categoría)'}: ${r.total}`));

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

actualizarCategorias();

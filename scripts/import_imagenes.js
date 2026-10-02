require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Producto, ProductoImagen } = require('../src/models');

async function run() {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = 2;

    const jsonPath = path.join(__dirname, '../../catalogo_enriquecido.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    for (let item of data) {
      if (!item.imagenes || item.imagenes.length === 0) continue;

      const producto = await Producto.findOne({
        where: { sku: item.sku, inquilino_id },
        transaction: t
      });

      if (!producto) {
        console.log(`Producto no encontrado para SKU: ${item.sku}`);
        continue;
      }

      // Eliminar imagenes anteriores (si las hubiera)
      await ProductoImagen.destroy({
        where: { producto_id: producto.id },
        transaction: t
      });

      // Insertar nuevas
      const imagenesAInsertar = item.imagenes.map((url, index) => ({
        inquilino_id: inquilino_id,
        producto_id: producto.id,
        url: url,
        es_principal: index === 0,
        orden: index
      }));

      await ProductoImagen.bulkCreate(imagenesAInsertar, { transaction: t });
      console.log(`Insertadas ${imagenesAInsertar.length} imágenes para SKU: ${item.sku}`);
    }

    await t.commit();
    console.log('Imágenes importadas exitosamente.');
  } catch (error) {
    await t.rollback();
    console.error('Error insertando imágenes:', error);
  } finally {
    process.exit(0);
  }
}

run();

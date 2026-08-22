require('dotenv').config();
const { Producto, ProductoImagen, sequelize } = require('./src/models');
const google = require('googlethis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

async function downloadImage(url, filename) {
  const filepath = path.join(process.cwd(), 'public', 'uploads', filename);
  
  const writer = fs.createWriteStream(filepath);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 10000,
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Conectado a DB');

    // Find all WINNINGSTAR products
    const productos = await Producto.findAll({
      where: {
        nombre: sequelize.where(sequelize.fn('LOWER', sequelize.col('nombre')), 'LIKE', '%winningstar%')
      },
      include: [{ model: ProductoImagen, as: 'imagenes' }]
    });

    console.log(`Encontrados ${productos.length} productos WINNINGSTAR`);

    for (const producto of productos) {
      console.log(`Buscando imagen para: ${producto.nombre}`);
      
      try {
        const images = await google.image(producto.nombre + " high resolution hd", { safe: false });
        
        if (images && images.length > 0) {
          // Get the first good image URL
          const imgUrl = images[0].url;
          console.log(`Encontrada URL: ${imgUrl}`);
          
          const filename = `${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
          
          try {
            await downloadImage(imgUrl, filename);
            console.log(`Descargada como ${filename}`);
            
            // Delete old images for this product (or just first one?)
            // We'll delete all existing images for this product
            await ProductoImagen.destroy({ where: { producto_id: producto.id } });
            
            // Add new image
            await ProductoImagen.create({
              producto_id: producto.id,
              url: `/uploads/${filename}`,
              orden: 0
            });
            
            console.log(`Actualizado producto ID ${producto.id}`);
          } catch (downloadErr) {
            console.log(`Error al descargar imagen para ${producto.nombre}: ${downloadErr.message}`);
          }
        } else {
          console.log(`No se encontraron imágenes para ${producto.nombre}`);
        }
      } catch (searchErr) {
        console.log(`Error en búsqueda para ${producto.nombre}: ${searchErr.message}`);
      }
      
      // Delay to avoid Google blocking
      await new Promise(r => setTimeout(r, 2000));
    }

  } catch (error) {
    console.error('Error global:', error);
  } finally {
    process.exit(0);
  }
}

run();

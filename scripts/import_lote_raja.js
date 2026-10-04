require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Producto, Proveedor } = require('../src/models');
const slugify = require('slugify');

async function run() {
  const t = await sequelize.transaction();
  try {
    const usuario_id = 11;
    const inquilino_id = 2;

    // 1. Crear o buscar Proveedor Raja
    let [proveedor] = await Proveedor.findOrCreate({
      where: { nombre: 'Raja', usuario_id },
      defaults: { activo: true },
      transaction: t
    });

    console.log('Proveedor Raja ID:', proveedor.id);

    // 2. Leer archivo JSON generado
    const jsonPath = path.join(__dirname, '../../catalogo_enriquecido.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // 3. Insertar/Actualizar productos
    for (let item of data) {
      const slug = slugify(item.nombre, { lower: true, strict: true }) + '-' + item.sku;
      
      const productoData = {
        inquilino_id,
        sku: item.sku,
        nombre: item.nombre,
        proveedor_id: proveedor.id,
        precio_base: item.precio_base,
        ficha_rubro: item.ficha_rubro,
        descripcion_corta: item.descripcion_corta,
        descripcion_larga: item.descripcion_larga,
        propuesta_valor: item.propuesta_valor,
        beneficios: item.beneficios,
        confianza: item.confianza,
        preguntas_frecuentes: item.preguntas_frecuentes,
        faq_titulo: item.faq_titulo,
        ficha_datos: item.ficha_datos,
        slug: slug,
        creado_por: 1,
        // Algunos campos obligatorios o default:
        cantidad_disponible: 100, // asumiendo algun stock
        stock_salon: 100,
        activo: true,
        estado_venta: 'en_venta'
      };

      // Upsert basado en SKU y inquilino_id
      const [producto, created] = await Producto.findOrCreate({
        where: { sku: item.sku, inquilino_id },
        defaults: productoData,
        transaction: t
      });

      if (!created) {
        await producto.update(productoData, { transaction: t });
        console.log(`Producto Actualizado: ${item.sku}`);
      } else {
        console.log(`Producto Creado: ${item.sku}`);
      }
    }

    await t.commit();
    console.log('Todos los productos cargados exitosamente.');
  } catch (error) {
    await t.rollback();
    console.error('Error cargando productos:', error);
  } finally {
    process.exit(0);
  }
}

run();

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Producto, Proveedor, sequelize } = require('../src/models');

async function run() {
  try {
    const proveedor = await Proveedor.findOne({ where: { nombre: 'WINNINGSTAR' } });
    if (!proveedor) {
      console.log('No se encontró el proveedor WINNINGSTAR.');
      process.exit(0);
    }
    
    if (!proveedor.precio_dolar) {
      console.log('El proveedor WINNINGSTAR no tiene configurado un precio_dolar.');
      console.log('Por favor, configuralo en la sección de Proveedores primero antes de correr este script.');
      process.exit(0);
    }

    const cotizacion = parseFloat(proveedor.precio_dolar);

    const productos = await Producto.findAll({ where: { proveedor_id: proveedor.id } });
    if (productos.length === 0) {
      console.log('No hay productos asignados a WINNINGSTAR.');
      process.exit(0);
    }

    let actualizados = 0;
    for (const p of productos) {
      // Si el producto ya tiene un precio_dolar guardado, recalculamos el precio_costo y precio_base (opcional, pero ayuda)
      const pDolar = parseFloat(p.precio_dolar) || 0;
      
      const payload = {
        es_dolar: true
      };

      if (pDolar > 0) {
        const costoCalculado = Math.round(pDolar * cotizacion);
        payload.precio_costo = costoCalculado;
        // También podemos actualizar el precio base (10% más) si queremos, pero lo dejamos opcional para no pisar precios de venta ya configurados
        // payload.precio_base = Math.round(costoCalculado * 1.1); 
      }

      await p.update(payload);
      actualizados++;
    }

    console.log(`¡Listo! Se actualizaron ${actualizados} productos de WINNINGSTAR para usar es_dolar = true y se recalculó su precio de costo según la cotización actual.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sequelize.close();
  }
}

run();

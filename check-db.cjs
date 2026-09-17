require('dotenv').config();
const { Envio, Oferta, Usuario } = require('./src/models');

async function testFacturacion() {
  try {
    console.log("Conectando a la base de datos...");
    const envios = await Envio.findAll({
      where: {
        quiere_factura: true,
        estado: 'Entregado'
      },
      attributes: ['id', 'fecha', 'confirmador', 'ruc', 'razon_social', 'monto', 'estado'],
      order: [['id', 'DESC']],
      limit: 25 // Traemos los ultimos 25 para ver si esta el que dice el usuario
    });

    console.log(`\nEncontrados ${envios.length} pedidos con quiere_factura=true y estado='Entregado':`);
    envios.forEach((e, index) => {
      console.log(`${index + 1}. ID: ${e.id} | Fecha: ${e.fecha} | RUC: ${e.ruc || '-'} | Monto: ${e.monto}`);
    });
    
    // Buscar especificamente el ID 4783 (que estaba en el screenshot viejo)
    const pedido4783 = await Envio.findByPk(4783);
    if (pedido4783) {
      console.log(`\nEstado actual del pedido 4783:`);
      console.log(`- Estado: ${pedido4783.estado}`);
      console.log(`- Factura: ${pedido4783.quiere_factura}`);
      console.log(`- Monto: ${pedido4783.monto}`);
    } else {
      console.log(`\nEl pedido 4783 no existe en la base de datos local.`);
    }

  } catch (error) {
    console.error("Error consultando:", error.message);
  } finally {
    process.exit(0);
  }
}

testFacturacion();

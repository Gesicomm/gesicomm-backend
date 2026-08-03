const { sequelize, Envio, EnvioItem, Producto, Courier, Usuario } = require('../src/models');
const { migrarEnvios } = require('./migrar-envios');

async function seedAnalytics() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');
    await migrarEnvios();

    // Buscar primer usuario
    const user = await Usuario.findOne();
    if (!user) {
      console.log('No user found to seed');
      return;
    }
    const usuario_id = user.id;

    // Buscar productos
    let productos = await Producto.findAll();
    if (productos.length === 0) {
      console.log('No products found to seed');
      return;
    }

    // Buscar o crear couriers
    let couriers = await Courier.findAll({ where: { usuario_id } });
    if (couriers.length === 0) {
      const c1 = await Courier.create({ usuario_id, nombre: 'AEX Paraguay', telefono: '0981 111 222', vehiculo: 'Furgón' });
      const c2 = await Courier.create({ usuario_id, nombre: 'Fix Courier Express', telefono: '0982 333 444', vehiculo: 'Moto' });
      const c3 = await Courier.create({ usuario_id, nombre: 'Delivery Propio Central', telefono: '0983 555 666', vehiculo: 'Moto' });
      couriers = [c1, c2, c3];
    }

    const countEnvios = await Envio.count({ where: { usuario_id } });
    console.log(`Current envios count: ${countEnvios}`);

    // Si hay menos de 15 envios, creamos un set variado para este mes y días previos
    if (countEnvios < 15) {
      const confirmadores = ['Sofía Benítez', 'Lucas Gómez', 'Camila Duarte', 'Martín Vera'];
      const origenes = ['WEB', 'WHATSAPP', 'LANDING', 'META_ADS'];
      const estados = ['Entregado', 'Rendido', 'En camino', 'Pendiente', 'Cancelado', 'Devuelto', 'Reagendado'];
      const ciudades = ['Asunción', 'San Lorenzo', 'Luque', 'Fernando de la Mora', 'Capiatá', 'Lambaré', 'Encarnación', 'Ciudad del Este'];
      const campanas = ['Promo_Setiembre_Lanzamiento', 'Meta_Retargeting_Ventas', 'Tiktok_Viral_2026', 'Google_Search_Top'];

      const hoy = new Date();

      for (let i = 0; i < 28; i++) {
        const d = new Date(hoy);
        d.setDate(d.getDate() - (i % 12));
        const fechaStr = d.toISOString().split('T')[0];
        
        const courier = couriers[i % couriers.length];
        const confirmador = confirmadores[i % confirmadores.length];
        const origen = origenes[i % origenes.length];
        const estado = estados[i % estados.length];
        const ciudad = ciudades[i % ciudades.length];
        const campana = campanas[i % campanas.length];

        const prod = productos[i % productos.length];
        const cant = (i % 3) + 1;
        const precioUnit = Number(prod.precio_base || prod.precio_venta || prod.precio || 150000);
        const subtotal = cant * precioUnit;
        const costoEnvio = 25000;
        const montoTotal = subtotal + costoEnvio;

        const estadoComercial = estado === 'Cancelado' ? 'Cancelado' : 'Confirmado';
        let estadoLogistico = 'Pendiente';
        if (['Entregado', 'Rendido'].includes(estado)) estadoLogistico = 'Entregado';
        else if (['En camino', 'Reagendado'].includes(estado)) estadoLogistico = 'En Tránsito';
        else if (estado === 'Devuelto') estadoLogistico = 'Devuelto';

        const nuevoEnvio = await Envio.create({
          usuario_id,
          courier_id: courier.id,
          cliente: `Cliente ${i + 1} ${ciudad}`,
          nombre_cliente: `Cliente ${i + 1}`,
          apellido_cliente: ciudad,
          telefono: `0981 ${100000 + i}`,
          ciudad,
          departamento: 'Central',
          direccion: `Avda. Principal #${i * 10 + 120}`,
          referencia: 'Cerca del supermercado',
          monto: montoTotal,
          costo_envio: costoEnvio,
          metodo_pago: i % 2 === 0 ? 'Efectivo' : 'Transferencia',
          estado,
          fecha: fechaStr,
          hora: `${10 + (i % 8)}:30`,
          dispatchedAt: fechaStr,
          fecha_rendicion: estado === 'Rendido' ? fechaStr : null,
          confirmador,
          origen,
          campaign_name: campana,
          estado_comercial: estadoComercial,
          estado_logistico: estadoLogistico,
        });

        await EnvioItem.create({
          envio_id: nuevoEnvio.id,
          producto_id: prod.id,
          nombre_producto: prod.nombre,
          cantidad: cant,
          precio_unitario: precioUnit,
          subtotal: subtotal
        });
      }
      console.log('Seeded 28 rich analytical orders.');
    }

    console.log('Analytics seed completed successfully.');
  } catch (err) {
    console.error('Error seeding analytics:', err);
  } finally {
    process.exit(0);
  }
}

seedAnalytics();

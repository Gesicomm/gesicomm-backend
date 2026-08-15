'use strict';

/**
 * Importa los pedidos de la planilla "Gestión Agosto.xlsx" (hoja "Gestión de
 * Pedidos") a las tablas envios/envio_items, creando couriers y productos
 * faltantes. Decisiones tomadas junto al usuario:
 *   - Todos los pedidos (Reven + Somnix Store) se cargan bajo usuario_id=16.
 *   - estado='Confirmado' tal cual figura en la planilla (no se infiere de
 *     los colores de las filas, se descartó ese criterio).
 *   - Precio de productos nuevos = precio unitario más frecuente (moda) en
 *     la planilla para ese producto.
 *   - No se descuenta stock real (cantidad_disponible) por ser carga
 *     histórica; solo se marca stock_descontado=true por idempotencia futura.
 *
 * Idempotente: cada pedido se identifica por el texto en `observaciones`
 * ("Planilla Agosto — Pedido #NNN (Tienda)"); si ya existe, se omite.
 *
 * Ejecutar: node scripts/importar-gestion-agosto.js [--dry-run]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Envio, EnvioItem, Courier, Producto } = require('../src/models');

const USUARIO_ID = 16;
const INQUILINO_ID = 2;
const DATA_PATH = path.join(
  '/private/tmp/claude-501/-Users-mertin-Proyectos-proyectos-Gesicomm/6b70c0c7-3fe2-41a7-9c99-08dc0a853927/scratchpad',
  'pedidos_agosto.json'
);

// Precio unitario (moda) por producto nuevo, calculado a partir de la planilla.
const PRECIO_PRODUCTO_NUEVO = {
  'Sombra para Pelo - #1 (negro)': 189000,
  'Sombra para Pelo - #2 (Cast. Oscuro)': 189000,
  'Lentes Rojos - GRIS': 106250,
  'Melatonina 10g': 169000,
  'Kit de Cejas - #05 Negro': 114000,
};

function slugify(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function marcaObservacion(pedido) {
  return `Planilla Agosto — Pedido #${pedido.numero} (${pedido.tienda})`;
}

async function resolverCourier(nombre, cache, t) {
  const key = nombre.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const candidatos = await Courier.findAll({ where: { usuario_id: USUARIO_ID }, transaction: t });
  let courier = candidatos.find(c => c.nombre.trim().toLowerCase() === key) || null;

  if (!courier) {
    courier = await Courier.create({
      usuario_id: USUARIO_ID,
      nombre: nombre.trim(),
      activo: true,
    }, { transaction: t });
    console.log(`  + Courier creado: "${courier.nombre}" (id=${courier.id})`);
  }
  cache.set(key, courier);
  return courier;
}

async function resolverProducto(nombre, cache, t) {
  const key = nombre.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const candidatos = await Producto.findAll({ where: { inquilino_id: INQUILINO_ID }, transaction: t });
  let producto = candidatos.find(p => p.nombre.trim().toLowerCase() === key) || null;

  if (!producto) {
    const precio = PRECIO_PRODUCTO_NUEVO[nombre] || 0;
    const slugBase = slugify(nombre);
    let slug = slugBase;
    let i = 2;
    while (candidatos.some(p => p.slug === slug)) {
      slug = `${slugBase}-${i++}`;
    }
    producto = await Producto.create({
      inquilino_id: INQUILINO_ID,
      nombre: nombre.trim(),
      precio_base: precio,
      cantidad_disponible: 0,
      slug,
      activo: true,
      estado_venta: 'en_venta',
    }, { transaction: t });
    console.log(`  + Producto creado: "${producto.nombre}" (id=${producto.id}, precio_base=${precio})`);
  }
  cache.set(key, producto);
  return producto;
}

async function importar({ dryRun = false } = {}) {
  const pedidos = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`Pedidos en planilla: ${pedidos.length}`);

  const t = await sequelize.transaction();
  const courierCache = new Map();
  const productoCache = new Map();
  let creados = 0;
  let omitidos = 0;

  try {
    for (const pedido of pedidos) {
      const observacion = marcaObservacion(pedido);

      const existente = await Envio.findOne({
        where: { usuario_id: USUARIO_ID, observaciones: observacion },
        transaction: t,
      });
      if (existente) {
        omitidos++;
        continue;
      }

      const courier = pedido.courier ? await resolverCourier(pedido.courier, courierCache, t) : null;

      const envio = await Envio.create({
        usuario_id: USUARIO_ID,
        courier_id: courier ? courier.id : null,
        fecha: pedido.fecha,
        hora: null,
        confirmador: pedido.confirmador,
        cliente: pedido.cliente,
        nombre_cliente: pedido.nombre_cliente,
        apellido_cliente: pedido.apellido_cliente,
        telefono: pedido.telefono,
        departamento: pedido.zona,
        ciudad: pedido.ciudad,
        direccion: pedido.link_maps || pedido.ciudad || 'No especificada',
        link_maps: pedido.link_maps,
        monto: pedido.monto,
        costo_envio: pedido.costo_envio,
        observaciones: observacion,
        estado: 'Confirmado',
        estado_comercial: 'Confirmado',
        estado_logistico: 'Pendiente',
        origen: 'WHATSAPP',
        dispatchedAt: pedido.fecha,
        stock_descontado: true,
        created_at: new Date(`${pedido.fecha}T12:00:00`),
        updated_at: new Date(`${pedido.fecha}T12:00:00`),
      }, { transaction: t });

      const nProductos = pedido.productos.length || 1;
      const nombresProductos = pedido.productos.length ? pedido.productos : ['Producto sin especificar'];
      const cantidadPorItem = Math.max(1, Math.round(pedido.cantidad_total / nProductos));
      const montoPorItem = Math.round(pedido.monto / nProductos);

      for (const nombreProducto of nombresProductos) {
        const producto = await resolverProducto(nombreProducto, productoCache, t);
        const precioUnitario = cantidadPorItem > 0 ? Math.round(montoPorItem / cantidadPorItem) : montoPorItem;
        await EnvioItem.create({
          envio_id: envio.id,
          producto_id: producto.id,
          nombre_producto: producto.nombre,
          cantidad: cantidadPorItem,
          precio_unitario: precioUnitario,
          subtotal: montoPorItem,
        }, { transaction: t });
      }

      creados++;
    }

    console.log(`\nEnvíos a crear: ${creados}, ya existentes (omitidos): ${omitidos}`);

    if (dryRun) {
      console.log('--dry-run: revirtiendo transacción, no se persiste nada.');
      await t.rollback();
    } else {
      await t.commit();
      console.log('Commit realizado.');
    }
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  importar({ dryRun })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la importación:', err);
      process.exit(1);
    });
}

module.exports = { importar };

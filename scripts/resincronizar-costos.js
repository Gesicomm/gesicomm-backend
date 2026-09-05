'use strict';

/**
 * Re-sincroniza el costo congelado (EnvioItemComponente.costo_unitario) con
 * la regla correcta de "cuánto le cuesta el producto al comerciante", y de
 * paso limpia el contador de tránsito que quedó huérfano.
 *
 * POR QUÉ HACE FALTA
 * El snapshot se escribe una sola vez, al confirmar el pedido. Los pedidos
 * confirmados antes del arreglo guardaron `precio_costo` — que es el costo
 * del ADMIN, no lo que paga el comerciante — así que su rentabilidad quedó
 * inflada. Este script los corrige.
 *
 * LA REGLA (la misma que envioController.costoParaComerciante):
 *   producto propio (creado_por = dueño del pedido) → precio_costo
 *   producto del catálogo del admin                 → precio_base
 *
 * OJO: solo sirve si `precio_base` está bien cargado. En un producto donde
 * ese campo tiene el precio de venta al público en vez del precio al
 * comerciante, este script lo dejaría costando lo mismo que se vendió.
 * Por eso corre en seco por defecto: primero mirá la tabla que imprime.
 *
 * ALCANCE
 * Sin filtros toca TODOS los pedidos de TODOS los usuarios. Acotá siempre
 * con --usuario y/o --desde salvo que de verdad quieras corregir todo: en
 * una corrida sin filtro se corrigió un pedido de otro usuario que no
 * estaba en el alcance previsto.
 *
 * USO
 *   node scripts/resincronizar-costos.js                    # simula, no escribe
 *   node scripts/resincronizar-costos.js --usuario 3        # solo ese comercio
 *   node scripts/resincronizar-costos.js --desde 2026-09-01 # solo desde esa fecha
 *   node scripts/resincronizar-costos.js --usuario 3 --aplicar
 */

const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const valorDe = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const desde = valorDe('--desde');
const usuario = valorDe('--usuario');

if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
  console.error('--desde tiene que ser una fecha YYYY-MM-DD');
  process.exit(1);
}
if (usuario && !/^\d+$/.test(usuario)) {
  console.error('--usuario tiene que ser un id numérico');
  process.exit(1);
}

const filtroFecha = desde ? `AND e.fecha >= '${desde}'` : '';
const filtroUsuario = usuario ? `AND e.usuario_id = ${usuario}` : '';

console.log(`Alcance: ${usuario ? 'usuario ' + usuario : 'TODOS los usuarios'}, ${desde ? 'desde ' + desde : 'sin límite de fecha'}`);

async function main() {
  const filas = await sequelize.query(`
    SELECT c.id, e.id AS envio, e.fecha, e.estado, c.producto_id, LEFT(p.nombre, 30) AS producto,
           c.cantidad, c.costo_unitario AS actual,
           CASE WHEN p.creado_por = e.usuario_id THEN p.precio_costo
                ELSE COALESCE(NULLIF(p.precio_base, 0), p.precio_costo) END AS correcto,
           (p.creado_por = e.usuario_id) AS es_propio
    FROM envio_item_componentes c
    JOIN envio_items ei ON ei.id = c.envio_item_id
    JOIN envios e ON e.id = ei.envio_id
    JOIN productos p ON p.id = c.producto_id
    WHERE 1 = 1 ${filtroFecha} ${filtroUsuario}
    ORDER BY e.fecha, c.id
  `, { type: QueryTypes.SELECT });

  const cambian = filas.filter(f => Number(f.actual) !== Number(f.correcto));

  console.log(`Snapshots en el alcance: ${filas.length} — a corregir: ${cambian.length}`);
  if (cambian.length > 0) {
    console.table(cambian.map(f => ({
      comp: f.id, envio: f.envio, fecha: f.fecha, producto: f.producto,
      propio: f.es_propio ? 'sí' : 'no',
      actual: Number(f.actual), correcto: Number(f.correcto),
    })));
  }

  if (!aplicar) {
    console.log('\nSimulación: no se escribió nada. Volvé a correr con --aplicar para guardar.');
    return;
  }

  const t = await sequelize.transaction();
  try {
    for (const f of cambian) {
      await sequelize.query(
        'UPDATE envio_item_componentes SET costo_unitario = :costo WHERE id = :id',
        { replacements: { costo: f.correcto, id: f.id }, transaction: t }
      );
    }

    // Tránsito huérfano: unidades marcadas "en camino" sin ningún pedido
    // Despachado/Reprogramado que lo justifique. Se acumulaban porque la
    // transición a Entregado no descontaba cantidad_transito (ya corregido
    // en envioController.consumirTransito); esto limpia lo que quedó.
    //
    // Acotado a los productos del alcance: sin ese límite se corrigen los de
    // todos los comercios, que no es lo que suele querer quien corre esto.
    const productosDelAlcance = [...new Set(filas.map(f => f.producto_id))];
    let trCount = 0;
    if (productosDelAlcance.length > 0) {
      const [, tr] = await sequelize.query(`
        UPDATE productos p SET cantidad_transito = 0
        WHERE p.cantidad_transito > 0
          AND p.id IN (${productosDelAlcance.join(',')})
          AND NOT EXISTS (
            SELECT 1 FROM envio_item_componentes c
            JOIN envio_items ei ON ei.id = c.envio_item_id
            JOIN envios e ON e.id = ei.envio_id
            WHERE c.producto_id = p.id AND e.estado IN ('Despachado', 'Reprogramado'))
      `, { transaction: t });
      trCount = tr.rowCount;
    }
    const tr = { rowCount: trCount };

    await t.commit();
    console.log(`\nListo: ${cambian.length} snapshot(s) corregido(s), ${tr.rowCount} producto(s) con tránsito huérfano en cero.`);
  } catch (err) {
    await t.rollback();
    console.error('Nada se guardó (rollback):', err.message);
    process.exitCode = 1;
  }
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());

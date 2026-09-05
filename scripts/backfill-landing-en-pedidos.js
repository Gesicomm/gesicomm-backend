'use strict';

/**
 * Recupera la landing de origen de los pedidos anteriores a Envio.landing_id.
 *
 * Cuando se agregó la columna se asumió que el dato no existía en ningún
 * lado. Existe: el checkout público, además de crear el pedido, escribe un
 * evento 'InitiateCheckout'/'Contact' en `landing_eventos` — que SÍ guarda
 * landing_id — dentro del mismo par de segundos. Cruzando por tiempo se
 * recupera el vínculo sin inventar nada: es un segundo registro del mismo
 * acto, no una suposición sobre cuál landing "habrá sido".
 *
 * Solo toca pedidos con `origen = 'LANDING'` (los cargados a mano y los de
 * WhatsApp no vinieron de ninguna página) y `landing_id IS NULL`.
 *
 * Si en la ventana hay eventos de MÁS DE UNA landing, el pedido se salta y
 * se reporta como ambiguo: preferimos dejarlo sin atribuir antes que
 * asignarlo a la página equivocada.
 *
 * Uso:
 *   node scripts/backfill-landing-en-pedidos.js                 (simulación)
 *   node scripts/backfill-landing-en-pedidos.js --aplicar
 *   node scripts/backfill-landing-en-pedidos.js --usuario=3 --ventana=30
 */

require('dotenv').config();
const { Op } = require('sequelize');
const sequelize = require('../src/config/database');
const { Envio, Landing, LandingEvento, Tienda } = require('../src/models');

const TIPOS_CHECKOUT = ['InitiateCheckout', 'Contact', 'Lead'];

function arg(nombre, porDefecto = null) {
  const found = process.argv.find(a => a.startsWith(`--${nombre}=`));
  return found ? found.split('=')[1] : porDefecto;
}

async function backfillLandingEnPedidos({ aplicar = false, usuario_id = null, ventanaSeg = 30 } = {}) {
  const where = { origen: 'LANDING', landing_id: null };
  if (usuario_id) where.usuario_id = usuario_id;

  const pedidos = await Envio.findAll({
    where,
    attributes: ['id', 'usuario_id', 'created_at', 'monto', 'nombre_cliente'],
    order: [['id', 'ASC']],
  });

  const resultados = { atribuidos: [], ambiguos: [], sin_evidencia: [] };

  for (const p of pedidos) {
    const tienda = await Tienda.findOne({ where: { usuario_id: p.usuario_id }, attributes: ['id'], raw: true });
    if (!tienda) { resultados.sin_evidencia.push({ id: p.id, motivo: 'el usuario no tiene tienda' }); continue; }

    const idsLanding = (await Landing.findAll({ where: { tienda_id: tienda.id }, attributes: ['id'], raw: true })).map(l => l.id);
    if (!idsLanding.length) { resultados.sin_evidencia.push({ id: p.id, motivo: 'la tienda no tiene landings' }); continue; }

    // El evento se escribe DESPUÉS de crear el pedido, pero se admite un
    // margen hacia atrás por si el orden se invierte bajo carga.
    const desde = new Date(p.created_at.getTime() - 5000);
    const hasta = new Date(p.created_at.getTime() + ventanaSeg * 1000);

    const eventos = await LandingEvento.findAll({
      where: {
        landing_id: { [Op.in]: idsLanding },
        tipo_evento: { [Op.in]: TIPOS_CHECKOUT },
        created_at: { [Op.between]: [desde, hasta] },
      },
      attributes: ['landing_id', 'tipo_evento', 'created_at', 'payload'],
      order: [['created_at', 'ASC']],
    });

    if (!eventos.length) { resultados.sin_evidencia.push({ id: p.id, motivo: `sin eventos de checkout en ±${ventanaSeg}s` }); continue; }

    const landingsEnVentana = [...new Set(eventos.map(e => e.landing_id))];
    if (landingsEnVentana.length > 1) {
      resultados.ambiguos.push({ id: p.id, landings: landingsEnVentana });
      continue;
    }

    const masCercano = eventos.reduce((a, b) =>
      Math.abs(b.created_at - p.created_at) < Math.abs(a.created_at - p.created_at) ? b : a);

    resultados.atribuidos.push({
      id: p.id,
      cliente: p.nombre_cliente,
      monto: Number(p.monto),
      landing_id: landingsEnVentana[0],
      delta_seg: Number(((masCercano.created_at - p.created_at) / 1000).toFixed(2)),
      evidencia: masCercano.payload?.custom_data?.content_name || masCercano.tipo_evento,
      valor_evento: masCercano.payload?.custom_data?.value ?? null,
    });
  }

  if (aplicar) {
    for (const r of resultados.atribuidos) {
      await Envio.update({ landing_id: r.landing_id }, { where: { id: r.id } });
    }
  }

  return resultados;
}

module.exports = { backfillLandingEnPedidos };

if (require.main === module) {
  const aplicar = process.argv.includes('--aplicar');
  const usuario_id = arg('usuario') ? Number(arg('usuario')) : null;
  const ventanaSeg = Number(arg('ventana', 30));

  (async () => {
    const r = await backfillLandingEnPedidos({ aplicar, usuario_id, ventanaSeg });
    const nombres = new Map((await Landing.findAll({ attributes: ['id', 'nombre'], raw: true })).map(l => [l.id, l.nombre]));

    console.log(aplicar ? '=== APLICANDO ===' : '=== SIMULACIÓN (no escribe nada; agregá --aplicar) ===');
    console.log(`\nSE PUEDEN ATRIBUIR (${r.atribuidos.length}):`);
    r.atribuidos.forEach(a => console.log(
      `  pedido ${a.id} · ${a.cliente} · Gs ${a.monto.toLocaleString('es-PY')}` +
      `\n     -> landing ${a.landing_id} "${nombres.get(a.landing_id) || '?'}" (evento a ${a.delta_seg}s: ${a.evidencia}${a.valor_evento ? ', valor ' + a.valor_evento : ''})`));
    if (r.ambiguos.length) {
      console.log(`\nAMBIGUOS, SE SALTAN (${r.ambiguos.length}):`);
      r.ambiguos.forEach(a => console.log(`  pedido ${a.id} -> eventos de varias landings: ${a.landings.join(', ')}`));
    }
    if (r.sin_evidencia.length) {
      console.log(`\nSIN EVIDENCIA, QUEDAN SIN LANDING (${r.sin_evidencia.length}):`);
      r.sin_evidencia.forEach(a => console.log(`  pedido ${a.id} — ${a.motivo}`));
    }
    console.log(aplicar ? '\nListo.' : '\nNada se modificó.');
    await sequelize.close();
  })().catch(e => { console.error(e); process.exit(1); });
}

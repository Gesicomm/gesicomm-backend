'use strict';

/**
 * Migración única: introduce el modelo Tienda y mueve a ella los campos
 * de tema/contacto/pixel que antes vivían en Landing, reemplazando
 * Landing.usuario_id por Landing.tienda_id.
 *
 * No usa sequelize.sync({alter:true}) global (ya causó un incidente en
 * este mismo proyecto con una tabla no relacionada) — hace DDL puntual
 * vía QueryInterface, todo dentro de UNA transacción (Postgres es
 * transaccional para DDL, así que si algo falla no queda nada a medias).
 *
 * Preserva datos reales existentes: por cada usuario_id distinto que
 * tenga landings, crea una Tienda y migra sus colores/whatsapp/mensaje/
 * pixel. La landing más vieja de cada usuario queda como es_home=true.
 *
 * Es un script de una sola vez — no se corre en cada boot. Ejecutar con:
 *   node scripts/migrate-tienda.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const slugify = require('slugify');
const { sequelize, Tienda, Usuario } = require('../src/models');

const RESERVADOS = (process.env.SUBDOMINIO_RESERVADOS || 'www,api,app,admin,mail,smtp,login,secure,account,billing,soporte,support,status,dev,staging,test,demo')
  .split(',').map(s => s.trim()).filter(Boolean);

async function generarSubdominioDisponible(base, transaction) {
  let limpio = slugify(base || 'tienda', { lower: true, strict: true }).slice(0, 60);
  if (limpio.length < 3) limpio = `tienda-${limpio}`;
  let candidato = limpio;
  let contador = 1;
  while (
    RESERVADOS.includes(candidato) ||
    await Tienda.findOne({ where: { subdominio: candidato }, transaction })
  ) {
    candidato = `${limpio}-${++contador}`;
  }
  return candidato;
}

async function migrar() {
  const t = await sequelize.transaction();
  try {
    const qi = sequelize.getQueryInterface();

    // 1. Tabla tiendas — sync individual, no toca ninguna otra tabla.
    await Tienda.sync();

    // 2. Columnas nuevas en landings (nullable por ahora, se endurecen al final)
    const columnas = await qi.describeTable('landings');
    if (!columnas.tienda_id) {
      await qi.addColumn('landings', 'tienda_id', { type: DataTypes.INTEGER, allowNull: true }, { transaction: t });
    }
    if (!columnas.es_home) {
      await qi.addColumn('landings', 'es_home', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
    }

    // 3. Leer landings existentes con sus campos viejos (raw — el modelo ya no los tiene)
    const [landingsRaw] = await sequelize.query(
      `SELECT id, usuario_id, color_primario, color_secundario, color_fondo,
              whatsapp, telefono, mensaje_contacto,
              meta_pixel_id, meta_access_token, meta_test_event_code, meta_capi_activo,
              created_at
       FROM landings ORDER BY created_at ASC`,
      { transaction: t },
    );

    // 4. Una Tienda por usuario_id distinto, migrando datos de su primera landing
    const usuarioIds = [...new Set(landingsRaw.map(l => l.usuario_id))];
    const mapaTienda = new Map();

    for (const usuarioId of usuarioIds) {
      const usuario = await Usuario.findByPk(usuarioId, { transaction: t });
      if (!usuario) continue;

      const primeraLanding = landingsRaw.find(l => l.usuario_id === usuarioId);
      const subdominio = await generarSubdominioDisponible(usuario.nombre, t);

      const tienda = await Tienda.create({
        usuario_id: usuarioId,
        inquilino_id: usuario.inquilino_id,
        nombre: `Tienda de ${usuario.nombre}`,
        subdominio,
        color_primario: primeraLanding.color_primario,
        color_secundario: primeraLanding.color_secundario,
        color_fondo: primeraLanding.color_fondo,
        whatsapp: primeraLanding.whatsapp,
        telefono: primeraLanding.telefono,
        mensaje_contacto: primeraLanding.mensaje_contacto,
        meta_pixel_id: primeraLanding.meta_pixel_id,
        meta_access_token: primeraLanding.meta_access_token,
        meta_test_event_code: primeraLanding.meta_test_event_code,
        meta_capi_activo: primeraLanding.meta_capi_activo,
      }, { transaction: t });

      mapaTienda.set(usuarioId, tienda.id);
      console.log(`  Tienda creada para usuario ${usuarioId} (${usuario.nombre}): subdominio "${subdominio}"`);
    }

    // 5. Setear tienda_id + es_home (la primera landing de cada tienda, por fecha) en cada fila
    const tiendasConHomeAsignado = new Set();
    for (const l of landingsRaw) {
      const tiendaId = mapaTienda.get(l.usuario_id);
      const esHome = !tiendasConHomeAsignado.has(tiendaId);
      if (esHome) tiendasConHomeAsignado.add(tiendaId);
      await sequelize.query(
        'UPDATE landings SET tienda_id = :tiendaId, es_home = :esHome WHERE id = :id',
        { replacements: { tiendaId, esHome, id: l.id }, transaction: t },
      );
    }

    // 6. Todas las filas ya tienen tienda_id — endurecer a NOT NULL
    await qi.changeColumn('landings', 'tienda_id', { type: DataTypes.INTEGER, allowNull: false }, { transaction: t });

    // 7. Reemplazar el índice único de slug (global) por (tienda_id, slug)
    const indices = await qi.showIndex('landings', { transaction: t });
    const indiceSlugViejo = indices.find(i => i.unique && i.fields.length === 1 && i.fields[0].attribute === 'slug');
    if (indiceSlugViejo) {
      await qi.removeIndex('landings', indiceSlugViejo.name, { transaction: t });
    }
    const indiceNuevo = indices.find(i =>
      i.unique && i.fields.length === 2 &&
      i.fields.some(f => f.attribute === 'tienda_id') &&
      i.fields.some(f => f.attribute === 'slug'),
    );
    if (!indiceNuevo) {
      await qi.addIndex('landings', { fields: ['tienda_id', 'slug'], unique: true, transaction: t });
    }

    // 8. Borrar columnas que ahora viven en Tienda (Postgres dropea solo
    // los índices que dependían únicamente de la columna borrada, ej. el
    // índice viejo sobre usuario_id — no hace falta borrarlo a mano).
    const columnasABorrar = [
      'usuario_id', 'color_primario', 'color_secundario', 'color_fondo',
      'whatsapp', 'telefono', 'mensaje_contacto',
      'meta_pixel_id', 'meta_access_token', 'meta_test_event_code', 'meta_capi_activo',
    ];
    for (const col of columnasABorrar) {
      if (columnas[col]) {
        await qi.removeColumn('landings', col, { transaction: t });
      }
    }

    await t.commit();
    console.log(`\nMigración completada. ${mapaTienda.size} tienda(s) creada(s), ${landingsRaw.length} landing(s) migrada(s).`);
  } catch (err) {
    await t.rollback();
    console.error('ROLLBACK — no se aplicó ningún cambio. Error:', err.message);
    throw err;
  }
}

migrar()
  .then(() => { process.exit(0); })
  .catch(() => { process.exit(1); });

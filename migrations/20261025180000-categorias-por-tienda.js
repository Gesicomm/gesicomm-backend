'use strict';
// Preserve product and price data; only separate category ownership/assignment.
module.exports = {
  async up(q, externa) {
    const ejecutar = async transaction => {
      const query = (sql, options = {}) => q.sequelize.query(sql, { ...options, transaction });
      await query(`ALTER TABLE categorias ADD COLUMN IF NOT EXISTS tienda_id INTEGER REFERENCES tiendas(id);
        CREATE INDEX IF NOT EXISTS categorias_tienda_idx ON categorias(tienda_id, inquilino_id);
        CREATE TABLE IF NOT EXISTS categoria_asignaciones_tienda (
          id SERIAL PRIMARY KEY, tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
          tipo VARCHAR(20) NOT NULL CHECK(tipo IN ('producto','combo')),
          referencia_id INTEGER NOT NULL, categoria_id INTEGER NOT NULL REFERENCES categorias(id),
          UNIQUE(tienda_id,tipo,referencia_id));
        CREATE TEMP TABLE categorias_mapa (anterior INTEGER, tienda INTEGER, nueva INTEGER, PRIMARY KEY(anterior,tienda)) ON COMMIT DROP;`);
      // Recover the store from product ownership. Legacy personalizations were
      // account-wide: preserve them separately in each eligible store, never
      // share the category record between those stores again.
      const [fuentes] = await query(`WITH RECURSIVE usos AS (
        SELECT categoria_id,tienda_id FROM productos WHERE categoria_id IS NOT NULL AND tienda_id IS NOT NULL
        UNION SELECT pu.categoria_id,t.id FROM precios_usuario pu JOIN tiendas t ON t.usuario_id=pu.usuario_id
          LEFT JOIN productos p ON pu.tipo='producto' AND p.id=pu.referencia_id
          WHERE pu.categoria_id IS NOT NULL AND (p.tienda_id IS NULL OR p.tienda_id=t.id)
        UNION SELECT c.parent_id,u.tienda_id FROM usos u JOIN categorias c ON c.id=u.categoria_id WHERE c.parent_id IS NOT NULL
      ) SELECT DISTINCT c.*,u.tienda_id destino FROM usos u JOIN categorias c ON c.id=u.categoria_id ORDER BY c.id,u.tienda_id`);
      for (const c of fuentes) {
        const destinos = fuentes.filter(x => x.id === c.id);
        const [globales] = await query('SELECT 1 FROM productos WHERE categoria_id=:id AND tienda_id IS NULL LIMIT 1', { replacements: { id:c.id } });
        let nueva = c.id;
        if (destinos.length === 1 && !globales.length) {
          await query('UPDATE categorias SET tienda_id=:tienda WHERE id=:id', { replacements: { tienda:c.destino,id:c.id } });
        } else {
          const [clones] = await query(`INSERT INTO categorias(inquilino_id,tienda_id,parent_id,nombre,slug,activo,created_at,updated_at)
            VALUES(:tenant,:tienda,:padre,:nombre,:slug,:activo,:creado,NOW()) RETURNING id`, { replacements: {
            tenant:c.inquilino_id,tienda:c.destino,padre:c.parent_id,nombre:c.nombre,
            slug:`${c.slug.slice(0,150)}-tienda-${c.destino}-origen-${c.id}`,activo:c.activo,creado:c.created_at } });
          nueva=clones[0].id;
        }
        await query('INSERT INTO categorias_mapa VALUES(:anterior,:tienda,:nueva)', {replacements:{anterior:c.id,tienda:c.destino,nueva}});
      }
      await query(`UPDATE categorias c SET parent_id=padre.nueva FROM categorias_mapa m
        JOIN categorias original ON original.id=m.anterior
        JOIN categorias_mapa padre ON padre.anterior=original.parent_id AND padre.tienda=m.tienda
        WHERE c.id=m.nueva;
        UPDATE productos p SET categoria_id=m.nueva FROM categorias_mapa m WHERE p.categoria_id=m.anterior AND p.tienda_id=m.tienda;
        INSERT INTO categoria_asignaciones_tienda(tienda_id,tipo,referencia_id,categoria_id)
        SELECT t.id,pu.tipo,pu.referencia_id,m.nueva FROM precios_usuario pu JOIN tiendas t ON t.usuario_id=pu.usuario_id
        JOIN categorias_mapa m ON m.anterior=pu.categoria_id AND m.tienda=t.id
        LEFT JOIN productos p ON pu.tipo='producto' AND p.id=pu.referencia_id
        WHERE p.tienda_id IS NULL OR p.tienda_id=t.id
        ON CONFLICT(tienda_id,tipo,referencia_id) DO NOTHING;`);
    };
    if (externa) await ejecutar(externa);
    else await q.sequelize.transaction(ejecutar);
  },
  async down() { throw new Error('La separación de categorías conserva datos por tienda y requiere una reversión revisada.'); },
};

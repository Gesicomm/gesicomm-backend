'use strict';

/**
 * Importa el catálogo NATURALCAPS (13 productos, "CATÁLOGO NATURALCAPS 2026.pdf")
 * a Producto/ProductoImagen/ProductoFaq/Categoria/Proveedor.
 *
 * Decisiones tomadas junto al usuario:
 *   - Proveedor: se crea/reutiliza "NaturalCaps".
 *   - Categorías: una por rubro del catálogo (Cápsulas, Gotas, Pomadas,
 *     Sérums), planas (sin parent_id) — mismo criterio que WINNINGSTAR.
 *   - Precios: flat para todo el catálogo (el PDF no trae precios, los dio
 *     el usuario directamente). precio_costo = 36.000 Gs (compra),
 *     precio_base = 40.000 Gs (venta a tiendas, ya incluye IVA). No usa
 *     precio_dolar — a diferencia de WINNINGSTAR, acá los precios ya están
 *     fijados en guaraníes, no hay conversión dinámica que recalcular.
 *   - Stock: el catálogo no trae cantidades. Arranca con 20 unidades y
 *     estado_venta=en_venta para los 13 — valor de arranque razonable, no
 *     stock real; ajustar en el panel.
 *   - SKU: "NC-{NOMBRE}" (el catálogo no trae códigos de producto).
 *   - Imagen: una por producto (foto de envase con fondo transparente,
 *     extraída del PDF). Se aplana a fondo blanco antes de convertir a
 *     JPEG (sharp .flatten) — si no, el canal alfa sale negro.
 *   - FAQ ("Todo lo que necesitas saber"): la primera pregunta es de uso/
 *     dosis (dato real del catálogo), las otras dos son operativas
 *     (envío/pago), mismo criterio que WINNINGSTAR.
 *
 * Idempotente: si ya existe un Producto con ese sku+inquilino_id, se omite.
 *
 * SEGURO POR DEFECTO: corre en modo simulación (dry-run) y no escribe nada
 * en la base ni en disco. Pasar --commit para ejecutar la carga real.
 *
 * Uso:
 *   node scripts/importar-naturalcaps.js                     (dry-run, resuelve admin automáticamente)
 *   node scripts/importar-naturalcaps.js --usuario-id=16      (dry-run, usuario específico)
 *   node scripts/importar-naturalcaps.js --commit --usuario-id=16
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  sequelize, Usuario, Rol, Proveedor, Categoria, Producto, ProductoImagen, ProductoFaq,
} = require('../src/models');

const DATA_DIR = path.join(__dirname, 'data', 'naturalcaps');
const DATASET_PATH = path.join(DATA_DIR, 'dataset.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

const PRECIO_COSTO = 36000;
const PRECIO_BASE = 40000;
const STOCK_INICIAL = 20;

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const argVal = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const USUARIO_ID_ARG = argVal('usuario-id') ? parseInt(argVal('usuario-id'), 10) : null;

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function resolverUsuario() {
  if (USUARIO_ID_ARG) {
    const u = await Usuario.findByPk(USUARIO_ID_ARG);
    if (!u) throw new Error(`No existe el usuario id=${USUARIO_ID_ARG}.`);
    return u;
  }
  const admins = await Usuario.findAll({
    include: [{ model: Rol, where: { nombre: 'administrador' }, attributes: ['nombre'] }],
  });
  if (admins.length === 0) {
    throw new Error('No se encontró ningún usuario con rol "administrador". Pasá --usuario-id=<id> explícitamente.');
  }
  if (admins.length > 1) {
    console.log('Hay más de un usuario administrador, pasá --usuario-id explícitamente:');
    admins.forEach(a => console.log(`  id=${a.id}  ${a.correo_electronico}  inquilino_id=${a.inquilino_id}`));
    throw new Error('Ambigüedad de usuario administrador.');
  }
  return admins[0];
}

async function resolverProveedor(usuario_id, dry) {
  let proveedor = await Proveedor.findOne({ where: { usuario_id, nombre: 'NaturalCaps' } });
  if (proveedor) {
    console.log(`Proveedor "NaturalCaps" ya existe (id=${proveedor.id}).`);
    return proveedor;
  }
  if (dry) {
    console.log('[dry-run] Crearía Proveedor "NaturalCaps".');
    return { id: null };
  }
  proveedor = await Proveedor.create({ usuario_id, nombre: 'NaturalCaps', activo: true });
  console.log(`+ Proveedor "NaturalCaps" creado (id=${proveedor.id}).`);
  return proveedor;
}

async function resolverCategorias(inquilino_id, nombres, dry) {
  const mapa = new Map();
  for (const nombre of nombres) {
    const slug = slugify(nombre);
    let cat = await Categoria.findOne({ where: { inquilino_id, slug } });
    if (!cat) {
      if (dry) {
        console.log(`[dry-run] Crearía Categoria "${nombre}" (slug=${slug}).`);
        mapa.set(nombre, { id: null });
        continue;
      }
      cat = await Categoria.create({ inquilino_id, nombre, slug, activo: true });
      console.log(`+ Categoria "${nombre}" creada (id=${cat.id}).`);
    } else {
      console.log(`Categoria "${nombre}" ya existe (id=${cat.id}).`);
    }
    mapa.set(nombre, cat);
  }
  return mapa;
}

/** Igual que ImagenService.guardarArchivo, pero aplanando alfa a blanco
 * primero: las fotos de envase del PDF tienen fondo transparente y JPEG
 * no soporta canal alfa (sharp lo rellenaría de negro si no se aplana). */
async function procesarImagen(srcPath) {
  const buffer = await fs.promises.readFile(srcPath);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const finalPath = path.join(UPLOADS_DIR, filename);
  await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(finalPath);
  return `/uploads/${filename}`;
}

async function generarSlugUnico(nombreBase, inquilino_id) {
  let base = slugify(nombreBase);
  let slug = base;
  let n = 1;
  while (await Producto.findOne({ where: { inquilino_id, slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

async function main() {
  console.log(COMMIT ? '=== MODO COMMIT: va a escribir en la base ===' : '=== DRY-RUN: no se escribe nada (pasá --commit para ejecutar) ===');

  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`No se encontró el dataset en ${DATASET_PATH}.`);
  }
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
  console.log(`Dataset: ${dataset.length} productos.`);

  const usuario = await resolverUsuario();
  console.log(`Usuario: id=${usuario.id} correo=${usuario.correo_electronico} inquilino_id=${usuario.inquilino_id}`);

  const categoriasNombres = [...new Set(dataset.map(p => p.categoria))];
  const proveedor = await resolverProveedor(usuario.id, !COMMIT);
  const categoriasMapa = await resolverCategorias(usuario.inquilino_id, categoriasNombres, !COMMIT);

  if (!fs.existsSync(UPLOADS_DIR) && COMMIT) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  let creados = 0, omitidos = 0, errores = 0;

  for (const p of dataset) {
    try {
      const existente = await Producto.findOne({ where: { sku: p.sku, inquilino_id: usuario.inquilino_id } });
      if (existente) {
        omitidos++;
        console.log(`- Omitido (ya existe): ${p.sku} "${p.nombre}"`);
        continue;
      }

      if (!COMMIT) {
        creados++;
        console.log(`[dry-run] Crearía: ${p.sku} "${p.nombre}" | categoria="${p.categoria}" | Gs costo ${PRECIO_COSTO} / venta ${PRECIO_BASE} | imagen=${p.imagen_archivo} | faq=${p.faq.length}`);
        continue;
      }

      const t = await sequelize.transaction();
      try {
        const categoria = categoriasMapa.get(p.categoria);
        const slug = await generarSlugUnico(p.nombre, usuario.inquilino_id);

        const producto = await Producto.create({
          inquilino_id: usuario.inquilino_id,
          nombre: p.nombre,
          sku: p.sku,
          categoria_id: categoria?.id || null,
          proveedor_id: proveedor?.id || null,
          tags: p.tags,
          descripcion_corta: p.descripcion_corta,
          descripcion_larga: p.descripcion_larga,
          faq_titulo: 'Todo lo que necesitas saber',
          precio_costo: PRECIO_COSTO,
          precio_base: PRECIO_BASE,
          impuestos_incluidos: true,
          cantidad_disponible: STOCK_INICIAL,
          stock_minimo: 0,
          unidad_medida: 'unidad',
          activo: true,
          estado_venta: 'en_venta',
          destacado: false,
          slug,
          creado_por: usuario.id,
          modificado_por: usuario.id,
        }, { transaction: t });

        if (p.faq && p.faq.length) {
          await ProductoFaq.bulkCreate(
            p.faq.map((f, idx) => ({ producto_id: producto.id, pregunta: f.pregunta, respuesta: f.respuesta, orden: idx })),
            { transaction: t }
          );
        }

        await t.commit();

        if (p.imagen_archivo) {
          const srcPath = path.join(IMAGES_DIR, p.imagen_archivo);
          if (fs.existsSync(srcPath)) {
            const url = await procesarImagen(srcPath);
            await ProductoImagen.create({
              inquilino_id: usuario.inquilino_id,
              producto_id: producto.id,
              url,
              es_principal: true,
              orden: 0,
            });
          } else {
            console.warn(`  ! Imagen no encontrada: ${srcPath}`);
          }
        }

        creados++;
        console.log(`+ Creado: ${p.sku} "${p.nombre}" (id=${producto.id})`);
      } catch (err) {
        await t.rollback();
        throw err;
      }
    } catch (err) {
      errores++;
      console.error(`  ! Error con ${p.sku}: ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Creados: ${creados}`);
  console.log(`Omitidos (ya existían): ${omitidos}`);
  console.log(`Errores: ${errores}`);
  if (!COMMIT) console.log('\nEsto fue un dry-run. Nada se escribió. Corré con --commit para ejecutar de verdad.');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
  });

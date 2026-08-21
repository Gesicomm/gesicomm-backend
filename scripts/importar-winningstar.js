'use strict';

/**
 * Importa el catálogo WINNINGSTAR (270 productos, planilla "26.1- WINNINGSTAR.xlsx")
 * a Producto/ProductoImagen/ProductoFaq/Categoria/Proveedor.
 *
 * Decisiones tomadas junto al usuario:
 *   - Proveedor: se crea/reutiliza "WINNINGSTAR" (Proveedor está scopeado por
 *     usuario_id, no por inquilino_id — ver models/Proveedor.js).
 *   - Categorías: una por solapa del Excel (15), planas (sin parent_id).
 *   - Precios: precio_dolar = precio "Gravada" en USD (costo real de compra,
 *     ya incluye el 10% de IVA que factura el proveedor). precio_costo (Gs)
 *     = precio_dolar × cotización. precio_base (Gs, venta) = precio_costo ×
 *     1.10 (margen del 10% pedido por el usuario). Cotización default:
 *     6.022,11 Gs/USD (21/08/2026) — pasar --cotizacion=NNNN para otro valor,
 *     recalcula precio_costo/precio_base a partir del precio_dolar guardado
 *     en el dataset.
 *   - Stock: la planilla solo trae SI/NO (no cantidades reales). SI → 10
 *     unidades y estado_venta=en_venta; NO → 0 y fuera_de_stock. Es un valor
 *     de arranque razonable, no un stock real — ajustar en el panel.
 *   - SKU: "WS-{modelo}" (el código interno del proveedor tiene un duplicado
 *     entre dos productos distintos en la planilla; el modelo no se repite).
 *   - Imagen: una por producto (la única que trae la planilla), cargada como
 *     principal. Se procesa igual que ImagenService.guardarArchivo (sharp,
 *     max 1200px, JPEG 80%).
 *   - FAQ ("Todo lo que necesitas saber"): generada por categoría/specs del
 *     producto, ver scripts/data/winningstar/dataset.json y build_dataset.py
 *     (en el scratchpad de la sesión que generó este import).
 *
 * Idempotente: si ya existe un Producto con ese sku+inquilino_id, se omite
 * (no se pisa lo que ya esté cargado/editado a mano).
 *
 * SEGURO POR DEFECTO: corre en modo simulación (dry-run) y no escribe nada
 * en la base ni en disco. Pasar --commit para ejecutar la carga real.
 *
 * Uso:
 *   node scripts/importar-winningstar.js                       (dry-run, resuelve admin automáticamente)
 *   node scripts/importar-winningstar.js --usuario-id=16        (dry-run, usuario específico)
 *   node scripts/importar-winningstar.js --commit --usuario-id=16
 *   node scripts/importar-winningstar.js --commit --cotizacion=6100.50
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  sequelize, Usuario, Rol, Proveedor, Categoria, Producto, ProductoImagen, ProductoFaq,
} = require('../src/models');

const DATA_DIR = path.join(__dirname, 'data', 'winningstar');
const DATASET_PATH = path.join(DATA_DIR, 'dataset.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const argVal = (name) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const USUARIO_ID_ARG = argVal('usuario-id') ? parseInt(argVal('usuario-id'), 10) : null;
const COTIZACION_ARG = argVal('cotizacion') ? parseFloat(argVal('cotizacion')) : null;

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
  let proveedor = await Proveedor.findOne({ where: { usuario_id, nombre: 'WINNINGSTAR' } });
  if (proveedor) {
    console.log(`Proveedor "WINNINGSTAR" ya existe (id=${proveedor.id}).`);
    return proveedor;
  }
  if (dry) {
    console.log('[dry-run] Crearía Proveedor "WINNINGSTAR".');
    return { id: null };
  }
  proveedor = await Proveedor.create({ usuario_id, nombre: 'WINNINGSTAR', activo: true });
  console.log(`+ Proveedor "WINNINGSTAR" creado (id=${proveedor.id}).`);
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

/** Igual que ImagenService.guardarArchivo: sharp, max 1200px, JPEG 80%. */
async function procesarImagen(srcPath) {
  const buffer = await fs.promises.readFile(srcPath);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const finalPath = path.join(UPLOADS_DIR, filename);
  await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(finalPath);
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
    throw new Error(`No se encontró el dataset en ${DATASET_PATH}. Corré primero build_dataset.py.`);
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

      const cotizacion = COTIZACION_ARG || (p.precio_costo / p.precio_dolar);
      const precioCosto = COTIZACION_ARG ? Math.round(p.precio_dolar * COTIZACION_ARG) : p.precio_costo;
      const precioBase = COTIZACION_ARG ? Math.round(precioCosto * 1.10) : p.precio_base;

      if (!COMMIT) {
        creados++;
        console.log(`[dry-run] Crearía: ${p.sku} "${p.nombre}" | categoria="${p.categoria}" | USD ${p.precio_dolar} -> Gs costo ${precioCosto} / venta ${precioBase} | imagen=${p.imagen_archivo} | faq=${p.faq.length}`);
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
          faq_titulo: p.faq_titulo,
          precio_dolar: p.precio_dolar,
          precio_costo: precioCosto,
          precio_base: precioBase,
          impuestos_incluidos: true,
          cantidad_disponible: p.cantidad_disponible,
          stock_minimo: 0,
          unidad_medida: 'unidad',
          activo: true,
          estado_venta: p.estado_venta,
          destacado: false,
          slug,
          creado_por: usuario.id,
          modificado_por: usuario.id,
        }, { transaction: t });

        if (p.faq && p.faq.length) {
          await ProductoFaq.bulkCreate(
            p.faq.map(f => ({ producto_id: producto.id, pregunta: f.pregunta, respuesta: f.respuesta, orden: f.orden })),
            { transaction: t }
          );
        }

        await t.commit();

        // La imagen se procesa/copia fuera de la transacción de la fila (I/O de disco).
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

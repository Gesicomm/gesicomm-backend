'use strict';

/**
 * Fase 2 (piloto) del import WINNINGSTAR: agrega imágenes de galería extra
 * (hasta 4 por producto) a los productos ya cargados por importar-winningstar.js,
 * usando fotos reales del mismo distribuidor (www.sate.com.py — el que figura
 * como fuente en el header de cada hoja del Excel original). Ver
 * scripts/data/winningstar/sku_images_map.txt (formato producto_id|sku|ruta_relativa)
 * y scripts/data/winningstar/extra_images/ (los archivos ya descargados).
 *
 * No toca la imagen principal — solo agrega a la galería (es_principal=false),
 * con orden empezando después de la principal (orden=0).
 *
 * Idempotente: si el producto ya tiene 2+ imágenes (principal + al menos una
 * extra), se omite, para no duplicar si se corre dos veces.
 *
 * SEGURO POR DEFECTO: dry-run salvo --commit.
 * Uso: node scripts/importar-winningstar-imagenes-extra.js [--commit]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { sequelize, Producto, ProductoImagen } = require('../src/models');

const DATA_DIR = path.join(__dirname, 'data', 'winningstar');
const MAP_PATH = path.join(DATA_DIR, 'sku_images_map.txt');
const IMAGES_DIR = path.join(DATA_DIR, 'extra_images');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_EXTRA_POR_PRODUCTO = 4;

const COMMIT = process.argv.includes('--commit');

async function procesarImagen(srcPath) {
  const buffer = await fs.promises.readFile(srcPath);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const finalPath = path.join(UPLOADS_DIR, filename);
  await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(finalPath);
  return `/uploads/${filename}`;
}

async function main() {
  console.log(COMMIT ? '=== MODO COMMIT ===' : '=== DRY-RUN (pasá --commit para ejecutar) ===');

  const lineas = fs.readFileSync(MAP_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  // Agrupar por producto_id
  const porProducto = new Map();
  for (const linea of lineas) {
    const [producto_id, sku, rutaRel] = linea.split('|');
    if (!porProducto.has(producto_id)) porProducto.set(producto_id, { sku, archivos: [] });
    porProducto.get(producto_id).archivos.push(rutaRel);
  }

  let productosOk = 0, imagenesCreadas = 0, omitidos = 0, errores = 0;

  for (const [producto_id, { sku, archivos }] of porProducto) {
    try {
      const producto = await Producto.findByPk(producto_id);
      if (!producto) { console.warn(`! Producto id=${producto_id} (${sku}) no existe, se omite.`); errores++; continue; }

      const existentes = await ProductoImagen.count({ where: { producto_id } });
      if (existentes >= 2) {
        console.log(`- Omitido ${sku}: ya tiene ${existentes} imágenes.`);
        omitidos++;
        continue;
      }

      const aCrear = archivos.slice(0, MAX_EXTRA_POR_PRODUCTO);
      if (!COMMIT) {
        console.log(`[dry-run] ${sku} (id=${producto_id}): agregaría ${aCrear.length} imágenes de galería.`);
        productosOk++;
        continue;
      }

      let orden = existentes; // la principal ya ocupa orden=0
      for (const rutaRel of aCrear) {
        const filename = rutaRel.split('/').pop();
        const srcPath = path.join(IMAGES_DIR, `${producto_id}_${sku}_${filename}`);
        if (!fs.existsSync(srcPath)) { console.warn(`  ! No encontrado: ${srcPath}`); continue; }
        const url = await procesarImagen(srcPath);
        await ProductoImagen.create({
          inquilino_id: producto.inquilino_id,
          producto_id,
          url,
          es_principal: false,
          orden: orden++,
        });
        imagenesCreadas++;
      }
      console.log(`+ ${sku} (id=${producto_id}): ${aCrear.length} imágenes agregadas.`);
      productosOk++;
    } catch (err) {
      errores++;
      console.error(`  ! Error con producto id=${producto_id}: ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Productos procesados: ${productosOk}`);
  console.log(`Imágenes creadas: ${imagenesCreadas}`);
  console.log(`Omitidos: ${omitidos}`);
  console.log(`Errores: ${errores}`);
  if (!COMMIT) console.log('\nDry-run. Nada se escribió. Corré con --commit para ejecutar.');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Error fatal:', err.message); process.exit(1); });

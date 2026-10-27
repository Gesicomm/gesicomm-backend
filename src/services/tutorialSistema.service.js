const TutorialSistema = require('../models/TutorialSistema');

const SECCIONES = Object.freeze([
  { clave: 'modulo.negocio', grupo: 'Mi negocio', nombre: 'Introducción' },
  { clave: 'modulo.ecommerce', grupo: 'E-commerce', nombre: 'Introducción' },
  { clave: 'ecommerce.inicio', grupo: 'E-commerce', nombre: 'Inicio' },
  { clave: 'ecommerce.categoria', grupo: 'E-commerce', nombre: 'Categorías' },
  { clave: 'ecommerce.producto', grupo: 'E-commerce', nombre: 'Vista producto' },
  { clave: 'ecommerce.checkout', grupo: 'E-commerce', nombre: 'Checkout' },
  { clave: 'ecommerce.legales', grupo: 'E-commerce', nombre: 'Páginas legales' },
  { clave: 'mi-negocio.tienda', grupo: 'Mi negocio', nombre: 'Tienda' },
  { clave: 'mi-negocio.contacto', grupo: 'Mi negocio', nombre: 'Contacto' },
  { clave: 'mi-negocio.pasarelas', grupo: 'Mi negocio', nombre: 'Pagos' },
  { clave: 'mi-negocio.economica', grupo: 'Mi negocio', nombre: 'Costos' },
  { clave: 'mi-negocio.analitica', grupo: 'Mi negocio', nombre: 'Analítica' },
  { clave: 'mi-negocio.raha', grupo: 'Mi negocio', nombre: 'Conexión a proveedor' },
  { clave: 'modulo.depositos', grupo: 'Depósitos', nombre: 'Introducción' },
  { clave: 'modulo.productos', grupo: 'Productos', nombre: 'Introducción' },
  { clave: 'modulo.clientes', grupo: 'Clientes', nombre: 'Introducción' },
  { clave: 'modulo.publicidad', grupo: 'Publicidad', nombre: 'Introducción' },
  { clave: 'modulo.comercial', grupo: 'Gestión Comercial', nombre: 'Introducción' },
  { clave: 'modulo.logistica', grupo: 'Gestión Logística', nombre: 'Introducción' },
  { clave: 'modulo.dashboard_operativo', grupo: 'Dashboard Operativo', nombre: 'Introducción' },
  { clave: 'modulo.dashboard_general', grupo: 'Dashboard General', nombre: 'Introducción' },
  { clave: 'modulo.finanzas', grupo: 'Control Financiero', nombre: 'Introducción' },
  { clave: 'modulo.importacion', grupo: 'Proveete con Gesicom', nombre: 'Introducción' },
  { clave: 'modulo.afiliados', grupo: 'Quiero ser afiliado', nombre: 'Introducción' },
  { clave: 'modulo.partner', grupo: 'Partner certificado', nombre: 'Introducción' },
  { clave: 'modulo.academia', grupo: 'Academia', nombre: 'Introducción' },
  { clave: 'modulo.configuracion', grupo: 'Configuración', nombre: 'Introducción' },
]);
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function normalizarYoutube(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  let url;
  try { url = new URL(texto); } catch { throw error('Ingresá un enlace válido de YouTube.'); }
  if (url.protocol !== 'https:') throw error('El enlace debe usar HTTPS.');
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw error('Ingresá un video de YouTube válido.');
  return `https://www.youtube.com/watch?v=${id}`;
}

async function listar() {
  const videos = await TutorialSistema.findAll({ attributes: ['clave', 'url'] });
  return { secciones: SECCIONES, videos: Object.fromEntries(videos.map(video => [video.clave, video.url])) };
}

async function guardar(clave, valor, administradorId) {
  if (!SECCIONES.some(seccion => seccion.clave === clave)) throw error('Sección de tutorial no válida.', 404);
  const url = normalizarYoutube(valor);
  if (url) {
    await TutorialSistema.upsert({ clave, url, actualizado_por: administradorId, updated_at: new Date() });
  } else {
    await TutorialSistema.destroy({ where: { clave } });
  }
  return { clave, url };
}

module.exports = { SECCIONES, normalizarYoutube, listar, guardar };

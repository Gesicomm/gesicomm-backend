'use strict';
const { permiteRutaModulo, permisosLegacy } = require('./modulosColaborador');

// Lista explícita: cualquier endpoint nuevo queda cerrado para colaboradores.
// La identidad nunca se reemplaza por la del propietario. comercioId solo
// delimita datos operativos; req.usuario.id sigue siendo el actor real.
function permite(permisos, modulo, escribir = false) {
  return permisos?.[modulo] === 'gestionar' || (!escribir && permisos?.[modulo] === 'ver');
}
function regla(req) {
  const path = req.originalUrl.split('?')[0].replace(/\/$/, '');
  const metodo = req.method;
  const p = req.usuario.accesos || {};
  const comercial = escribir => permite(p, 'comercial', escribir);
  const logistica = escribir => permite(p, 'logistica', escribir);
  const operativo = comercial(false) || logistica(false);
  const consultaOperativa = operativo || permite(p, 'dashboard_operativo');
  if (/^\/api\/auth\/(me|perfil|perfil\/solicitar-otp|seleccionar-tienda)$/.test(path)) return true;
  if (path === '/api/tiendas/mias' && metodo === 'GET') return true;
  if (!req.usuario.tiendaId) return false;
  if (permiteRutaModulo(req)) return true;
  if (path === '/api/mi-tienda' && metodo === 'GET') return true;
  if (path === '/api/envios/metricas-dashboard' || path === '/api/envios/dashboard-general') return metodo === 'POST' && permite(p, 'dashboard_operativo');
  // La lista del módulo Clientes es este mismo reporte (sin fechas).
  if (path === '/api/reportes/clientes') return metodo === 'POST' && (permite(p, 'dashboard_operativo') || permite(p, 'clientes'));
  if (/^\/api\/reportes\/(kpis|evolucion-ventas|pedidos|items|comisiones|facturacion|productos|confirmadores|composicion|clientes|metodos-pago|fallos|geografia|logistica|cross-selling)$/.test(path)) return metodo === 'POST' && permite(p, 'dashboard_operativo');
  if (/^\/api\/envios\/(list|list-paginado|conteo-por-estado)$/.test(path)) return metodo === 'POST' && operativo;
  if (/^\/api\/envios\/(resumen|seguimiento\/(tablero|pendientes))$/.test(path)) return metodo === 'POST' && comercial(false);
  if (path === '/api/envios/resumen-entregados') return metodo === 'POST' && logistica(false);
  if (/^\/api\/envios\/\d+\/historial$/.test(path)) return metodo === 'GET' && operativo;
  if (/^\/api\/envios\/\d+\/seguimiento\/(flujos|imagenes\/\d+|contactos|etiquetas|historial)$/.test(path) && metodo === 'GET') return comercial(false);
  if (/^\/api\/envios\/\d+\/seguimiento\/(contactos|etiquetas(?:\/\d+)?|fases\/\d+\/completar|recordatorio(?:\/\d+\/(completar|cancelar))?|nota)$/.test(path)) return comercial(true);
  if (/^\/api\/envios\/\d+\/(lead-tipo|items\/\d+\/precio)$/.test(path)) return comercial(true) && ['PUT', 'PATCH'].includes(metodo);
  if (/^\/api\/envios\/\d+\/(devolucion|perdida)$/.test(path)) return metodo === 'POST' && logistica(true);
  if (path === '/api/envios' && metodo === 'POST') return comercial(true) &&
    (!req.body.estado || ['Pendiente', 'EnSeguimiento', 'Confirmado'].includes(req.body.estado)) &&
    (!req.body.estado_comercial || ['Pendiente', 'EnSeguimiento', 'Confirmado'].includes(req.body.estado_comercial)) &&
    (!req.body.estado_logistico || req.body.estado_logistico === 'Pendiente');
  if (path === '/api/envios/cotizar-entrega-raha') return metodo === 'POST' && comercial(false);
  if (/^\/api\/envios\/\d+\/proveedor-logistico-sugerido$/.test(path)) return metodo === 'GET' && operativo;
  if (/^\/api\/envios\/\d+\/estado$/.test(path) && metodo === 'PUT') {
    if (comercial(true) && logistica(true)) return true;
    const b = req.body || {};
    const estado = b.estado;
    if (comercial(true)) {
      return (!estado || ['Pendiente', 'EnSeguimiento', 'Confirmado', 'Cancelado'].includes(estado)) &&
        (!b.estado_comercial || ['Pendiente', 'EnSeguimiento', 'Confirmado', 'Cancelado'].includes(b.estado_comercial)) &&
        b.estado_logistico === undefined && b.fecha_reprogramada === undefined && b.costo_intento === undefined;
    }
    if (logistica(true)) {
      const campos = ['estado', 'courier_id', 'proveedor_logistico_id', 'fecha_reprogramada', 'motivo_reprogramacion', 'costo_intento', 'metodo_pago_id', 'metodo_pago', 'metodo_pago_canal', 'comision_pct_aplicada', 'nro_comprobante'];
      return Object.keys(b).every(k => campos.includes(k)) && (!estado || ['Despachado', 'Entregado', 'Reprogramado', 'Cancelado'].includes(estado));
    }
    return false;
  }
  if (/^\/api\/liquidaciones\/(previsualizar|courier\/\d+|saldos-pendientes)$/.test(path)) return logistica(false);
  if (path === '/api/liquidaciones/confirmar') return metodo === 'POST' && logistica(true);
  // Catálogos auxiliares del pedido: lectura, nunca administración.
  if (metodo === 'GET' && ['/api/couriers', '/api/couriers/zonas-delivery', '/api/metodos-pago', '/api/canales-venta'].includes(path)) return consultaOperativa;
  if (path === '/api/couriers/geografia' && metodo === 'POST') return operativo;
  if (path === '/api/productos/buscar' && metodo === 'POST') return comercial(false) || permite(p, 'dashboard_operativo');
  if (path === '/api/config/payment-gateways/pagopar/formas-pago' && metodo === 'GET') return comercial(false);
  if (/^\/api\/productos\/\d+(\/(variantes|opciones|imagenes))?$/.test(path) && metodo === 'GET') return comercial(false);
  if (/^\/api\/productos\/\d+\/ofertas\/buscar$/.test(path) && metodo === 'POST') return comercial(false);
  if (path === '/api/depositos/listado' && metodo === 'POST') return comercial(false);
  if (/^\/api\/depositos\/\d+\/couriers$/.test(path) && metodo === 'GET') return comercial(false);
  if (path === '/api/inventario/stock/pedido-origenes' && metodo === 'POST') return comercial(false);
  if (/^\/api\/seguimiento\/(flujos(?:\/\d+)?|plantillas(?:\/\d+)?|variables|etiquetas|configuracion)$/.test(path)) return metodo === 'GET' && comercial(false);
  if (path === '/api/seguimiento/notificaciones' && metodo === 'GET') return operativo;
  if (/^\/api\/seguimiento\/notificaciones\/(\d+\/leida|leer-todas)$/.test(path)) return metodo === 'PATCH' && operativo;
  return false;
}

async function accesoColaborador(req, res, next) {
  const { Usuario, Tienda, Envio, Courier, MetodoPago } = require('../models');
  const Miembro = require('../models/TiendaMiembro');
  try {
    const persona = await Usuario.findByPk(req.usuario.id);
    if (!persona || !persona.activo || !persona.email_verificado) return res.status(403).json({ message: 'Tu acceso está desactivado.' });
    req.usuario.accesos = {};
    if (req.usuario.tiendaId) {
      const miembro = await Miembro.findOne({ where: { usuario_id: persona.id, tienda_id: req.usuario.tiendaId, estado: 'activo' } });
      if (!miembro) {
        const bootstrap = req.originalUrl.split('?')[0].replace(/\/$/, '');
        if (['/api/auth/me', '/api/auth/seleccionar-tienda', '/api/tiendas/mias'].includes(bootstrap)) {
          req.usuario.tiendaId = null;
          req.usuario.permisos = [];
          return next();
        }
        return res.status(403).json({ message: 'Ya no tenés acceso a esta tienda.', codigo: 'ACCESO_REVOCADO' });
      }
      const tienda = await Tienda.findByPk(miembro.tienda_id);
      if (!tienda) return res.status(403).json({ message: 'Tienda no disponible.' });
      req.usuario.accesos = miembro.permisos;
      req.comercioId = tienda.usuario_id;
      req.usuario.propietarioId = tienda.usuario_id;
      const propietario = await Usuario.findByPk(tienda.usuario_id, { attributes: ['inquilino_id'] });
      if (!propietario) return res.status(403).json({ message: 'Tienda no disponible.' });
      req.usuario.tenantId = propietario.inquilino_id;
      // No conceder permisos globales del propietario.
      req.usuario.permisos = permisosLegacy(miembro.permisos);
      if (!regla(req)) return res.status(403).json({ message: 'No tenés permiso para esta acción.' });
      const path = req.originalUrl.split('?')[0].replace(/\/$/, '');
      if ((path === '/api/envios' && req.method === 'POST') || (/^\/api\/envios\/\d+\/estado$/.test(path) && req.method === 'PUT')) {
        if (req.body?.courier_id) {
          const courier = await Courier.findOne({ where: { id: req.body.courier_id, usuario_id: tienda.usuario_id, tienda_id: tienda.id } });
          if (!courier) return res.status(404).json({ message: 'Courier no encontrado en esta tienda.' });
        }
        if (req.body?.metodo_pago_id) {
          const metodo = await MetodoPago.findOne({ where: { id: req.body.metodo_pago_id, usuario_id: tienda.usuario_id } });
          if (!metodo) return res.status(404).json({ message: 'Método de pago no encontrado.' });
        }
      }
      if (path.startsWith('/api/liquidaciones/')) {
        const courierId = path.match(/\/courier\/(\d+)$/)?.[1] || req.body?.courier_id;
        const courier = await Courier.findOne({ where: { id: courierId, usuario_id: tienda.usuario_id, tienda_id: tienda.id } });
        if (!courier) return res.status(404).json({ message: 'Courier no encontrado.' });
      }
      if (path === '/api/mi-tienda' && req.method === 'GET' && !['negocio', 'ecommerce', 'depositos', 'productos'].some(m => permite(miembro.permisos, m))) {
        return res.json({ id: tienda.id, nombre: tienda.nombre, subdominio: tienda.subdominio, logo_imagen: tienda.logo_imagen,
          whatsapp: tienda.whatsapp, mensaje_confirmacion_pedido: tienda.mensaje_confirmacion_pedido });
      }
      const pedido = path.match(/^\/api\/envios\/(\d+)\//);
      if (pedido) {
        const envio = await Envio.findOne({ where: { id: Number(pedido[1]), tienda_id: tienda.id, usuario_id: tienda.usuario_id } });
        if (!envio) return res.status(404).json({ message: 'Pedido no encontrado.' });
        if (path.endsWith('/estado') && req.method === 'PUT' && !permite(miembro.permisos, 'logistica', true) &&
          !['Pendiente', 'EnSeguimiento'].includes(envio.estado)) return res.status(403).json({ message: 'Este pedido requiere permiso de Gestión Logística.' });
      }
    } else if (!regla(req)) {
      return res.status(403).json({ message: 'Seleccioná una tienda autorizada.' });
    }
    return next();
  } catch (e) { return next(e); }
}
module.exports = { accesoColaborador, regla, permite };

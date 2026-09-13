const express = require('express');
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const AuthTracking = require('../services/authTracking.service');
const SuscripcionService = require('../services/suscripcion.service');

const router = express.Router();

router.use(verificarToken);
router.use(soloAdministrador);

router.post('/resumen', async (req, res) => {
  try {
    const datos = await AuthTracking.resumen({ dias: req.body?.dias });
    return res.json(datos);
  } catch (err) {
    console.error('[admin-auth-tracking] resumen:', err);
    return res.status(500).json({ message: 'Error al obtener el resumen de seguridad.' });
  }
});

router.post('/pagos/resumen-general', async (req, res) => {
  try {
    const datos = await AuthTracking.resumenPagosAdmin({ dias: req.body?.dias });
    return res.json(datos);
  } catch (err) {
    console.error('[admin-auth-tracking] resumen pagos admin:', err);
    return res.status(500).json({ message: 'Error al obtener el estado general de pagos.' });
  }
});

router.post('/productos/top', async (req, res) => {
  try {
    const datos = await AuthTracking.topProductosAdmin({
      dias: req.body?.dias,
      limite: req.body?.limite,
    });
    return res.json(datos);
  } catch (err) {
    console.error('[admin-auth-tracking] top productos:', err);
    return res.status(500).json({ message: 'Error al obtener los productos más vendidos.' });
  }
});

router.post('/pagopar/suscripciones', async (req, res) => {
  try {
    const datos = await AuthTracking.listarPagosSuscripcion({
      pagina: req.body?.pagina,
      filtros: req.body?.filtros || {},
    });
    return res.json(datos);
  } catch (err) {
    console.error('[admin-auth-tracking] pagos suscripción:', err);
    return res.status(500).json({ message: 'Error al obtener pagos de suscripción.' });
  }
});

router.post('/eventos', async (req, res) => {
  try {
    const eventos = await AuthTracking.listarEventos({
      pagina: req.body?.pagina,
      filtros: req.body?.filtros || {},
    });
    return res.json(eventos);
  } catch (err) {
    console.error('[admin-auth-tracking] eventos:', err);
    return res.status(500).json({ message: 'Error al obtener eventos de autenticación.' });
  }
});

router.post('/sesiones', async (req, res) => {
  try {
    const sesiones = await AuthTracking.listarSesionesActivas({
      pagina: req.body?.pagina,
      filtros: req.body?.filtros || {},
    });
    return res.json(sesiones);
  } catch (err) {
    console.error('[admin-auth-tracking] sesiones:', err);
    return res.status(500).json({ message: 'Error al obtener sesiones activas.' });
  }
});

router.post('/notificaciones', async (req, res) => {
  try {
    const notificaciones = await AuthTracking.listarNotificaciones({
      pagina: req.body?.pagina,
      filtros: req.body?.filtros || {},
    });
    return res.json(notificaciones);
  } catch (err) {
    console.error('[admin-auth-tracking] notificaciones:', err);
    return res.status(500).json({ message: 'Error al obtener notificaciones.' });
  }
});

router.post('/pagopar/suscripciones/consultar', async (req, res) => {
  try {
    const hashPedido = String(req.body?.hash_pedido || req.body?.hash || '').trim();
    if (!hashPedido) {
      return res.status(400).json({ message: 'Indicá el hash_pedido de PagoPar.' });
    }

    const estado = await SuscripcionService.consultarYReconciliarPagoPorHash(hashPedido, {
      req,
      origen: 'Consulta admin PagoPar',
    });

    if (!estado) {
      return res.status(404).json({
        message: 'No encontramos un pago de suscripción con ese hash_pedido.',
      });
    }

    return res.json(estado);
  } catch (err) {
    console.error('[admin-auth-tracking] consultar suscripción PagoPar:', err.response?.data || err);
    return res.status(400).json({
      message: err.message || 'No se pudo consultar el pago en PagoPar.',
    });
  }
});

router.patch('/notificaciones/leidas', async (req, res) => {
  try {
    const resultado = await AuthTracking.marcarNotificacionesLeidas(req.body?.ids || null);
    return res.json(resultado);
  } catch (err) {
    console.error('[admin-auth-tracking] marcar leídas:', err);
    return res.status(500).json({ message: 'Error al marcar notificaciones como leídas.' });
  }
});

module.exports = router;

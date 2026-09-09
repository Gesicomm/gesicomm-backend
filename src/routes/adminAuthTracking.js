const express = require('express');
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const AuthTracking = require('../services/authTracking.service');

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

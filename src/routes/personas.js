const router = require('express').Router();
const { verificarToken } = require('../middleware/autenticacion');
const servicio = require('../services/accesos.service');
const rateLimit = require('express-rate-limit');
const limite = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const ejecutar = fn => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await fn(req)); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ message: 'La persona ya fue agregada. Actualizá el listado.' });
    next(e);
  }
};
// El secreto viaja en el cuerpo, nunca en logs de URL ni parámetros de consulta.
router.post('/invitacion', limite, ejecutar(req => servicio.consultar(req.body?.token)));
router.post('/aceptar', limite, ejecutar(req => servicio.aceptar(req.body?.token, req.body?.password)));
router.get('/', verificarToken, ejecutar(req => servicio.listar(req.usuario)));
router.post('/', verificarToken, limite, ejecutar(req => servicio.crear(req.usuario, req.body || {})));
router.patch('/:id', verificarToken, ejecutar(req => servicio.actualizar(req.usuario, req.params.id, req.body || {})));
module.exports = router;

const jwt = require('jsonwebtoken');
const { Courier, CourierAcceso } = require('../models');

function courierJwtSecret() {
  return process.env.COURIER_JWT_SECRET || process.env.JWT_SECRET || 'secret';
}

function leerBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

async function verificarCourierToken(req, res, next) {
  try {
    const token = leerBearer(req);
    if (!token) return res.status(401).json({ error: 'Token de courier requerido' });

    const payload = jwt.verify(token, courierJwtSecret());
    if (payload?.tipo !== 'courier') {
      return res.status(401).json({ error: 'Token de courier inválido' });
    }

    const acceso = await CourierAcceso.findOne({
      where: {
        id: payload.acceso_id,
        courier_id: payload.courier_id,
        usuario_id: payload.usuario_id,
        activo: true,
      },
      include: [{ model: Courier, as: 'courier', required: true }],
    });

    if (!acceso || acceso.courier?.activo === false) {
      return res.status(401).json({ error: 'Acceso de courier desactivado' });
    }

    req.courier = {
      accesoId: acceso.id,
      courierId: acceso.courier_id,
      usuarioId: acceso.usuario_id,
      username: acceso.username,
      nombre: acceso.courier.nombre,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión de courier inválida o vencida' });
  }
}

module.exports = {
  courierJwtSecret,
  verificarCourierToken,
};

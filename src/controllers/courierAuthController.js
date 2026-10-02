const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Courier, CourierAcceso } = require('../models');
const { courierJwtSecret } = require('../middleware/autenticacionCourier');
const { envolverControlador } = require('../utils/asyncHandler');

function accesoPublico(acceso) {
  return {
    username: acceso.username,
    courier_id: acceso.courier_id,
    usuario_id: acceso.usuario_id,
    courier_nombre: acceso.courier?.nombre || '',
  };
}

exports.login = async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  const acceso = await CourierAcceso.findOne({
    where: { username, activo: true },
    include: [{ model: Courier, as: 'courier', required: true }],
  });

  if (!acceso || acceso.courier?.activo === false) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  const ok = await bcrypt.compare(password, acceso.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas.' });

  await acceso.update({ ultimo_acceso: new Date() });

  const token = jwt.sign({
    tipo: 'courier',
    acceso_id: acceso.id,
    courier_id: acceso.courier_id,
    usuario_id: acceso.usuario_id,
  }, courierJwtSecret(), { expiresIn: '12h' });

  return res.json({ token, courier: accesoPublico(acceso) });
};

exports.me = async (req, res) => {
  return res.json({ courier: req.courier });
};

exports.logout = async (_req, res) => {
  return res.json({ success: true });
};

envolverControlador(module.exports);

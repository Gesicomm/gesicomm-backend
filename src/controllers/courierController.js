const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize, Courier, CourierAcceso, DeliveryZonaTarifa } = require('../models');
const RedFulfillmentService = require('../services/redFulfillment.service');
const { envolverControlador } = require('../utils/asyncHandler');

const ACCESS_ATTRIBUTES = ['id', 'courier_id', 'usuario_id', 'username', 'activo', 'ultimo_acceso', 'created_at', 'updated_at'];

function usernameLimpio(username) {
  return String(username || '').trim().toLowerCase();
}

function accesoSeguro(acceso) {
  if (!acceso) return null;
  const plain = acceso.toJSON ? acceso.toJSON() : acceso;
  delete plain.password_hash;
  return plain;
}

function validarPassword(password) {
  const clean = String(password || '');
  if (clean.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  return null;
}

async function courierDelUsuario(courierId, usuarioId, tiendaId) {
  const where = { id: courierId, usuario_id: usuarioId };
  if (tiendaId) where.tienda_id = tiendaId;
  return Courier.findOne({ where });
}

/** Los couriers PROPIOS de la tienda activa (no los de Gesicomm). */
async function courierIdsDeTienda(usuario_id, tiendaId) {
  const where = { usuario_id };
  if (tiendaId) where.tienda_id = tiendaId;
  const couriers = await Courier.findAll({ where, attributes: ['id'] });
  return couriers.map(c => c.id);
}

/**
 * Las tarifas del comercio, tal como las consumen el listado y el guardado.
 * DeliveryZonaTarifa no tiene columna tienda_id propia: una regla siempre
 * está atada a un courier (la invariante de la tabla lo exige para el
 * alcance "comercio"), así que se filtra acotando a los couriers de la
 * tienda activa.
 */
async function zonasDelUsuario(usuario_id, tiendaId) {
  const where = { usuario_id };
  if (tiendaId) where.courier_id = { [Op.in]: await courierIdsDeTienda(usuario_id, tiendaId) };
  return DeliveryZonaTarifa.findAll({
    where,
    include: [{ model: Courier, as: 'courier', attributes: ['id', 'nombre', 'activo'], required: false }],
    order: [['departamento', 'ASC'], ['ciudad', 'ASC'], ['rango_min', 'ASC']],
  });
}

/**
 * Las tarifas de un courier viven en `delivery_zona_tarifas` y se
 * administran por `replaceZonasDelivery` (el asistente del panel Delivery
 * las guarda junto con el courier). La tabla `courier_tarifas` quedó como
 * legacy: este controller ya no la lee ni la escribe, así que un `tarifas`
 * que llegue en el body se ignora deliberadamente.
 */
/**
 * Un courier pertenece siempre al comercio que lo crea.
 *
 * Acá vivía `alcance`, que permitía marcar un courier como "de Gesicomm" y lo
 * volvía utilizable por cualquier comercio. Esa era la forma provisoria de
 * representar la red logística, y mezclaba dos cosas distintas: los
 * operadores de la red son proveedores logísticos, viven en su propia entidad
 * y se administran desde Fulfillment.
 */

/**
 * Una regla de tarifa del comercio, normalizada.
 *
 * `courier_id` queda en null si el courier no es del usuario. El handler
 * rechaza el guardado entero en ese caso: una regla sin courier da un precio
 * que nadie está asignado a cumplir, y la invariante de la tabla la prohíbe.
 */
function normalizarZonaDelivery(t, usuarioId, couriersPermitidos) {
  t = t || {};
  const courierId = (t.courier_id === '' || t.courier_id === undefined || t.courier_id === null)
    ? null
    : Number(t.courier_id);
  const numeroONull = (valor) => (
    valor === '' || valor === undefined || valor === null ? null : Number(valor)
  );
  return {
    usuario_id: usuarioId,
    courier_id: courierId && couriersPermitidos.has(courierId) ? courierId : null,
    departamento: t.departamento ? String(t.departamento).trim() : null,
    ciudad: String(t.ciudad || t.ciudad_zona || '').trim(),
    ciudad_id: numeroONull(t.ciudad_id),
    departamento_id: numeroONull(t.departamento_id),
    pais_id: numeroONull(t.pais_id),
    tipo_cobertura: t.tipo_cobertura || 'CIUDAD',
    tipo_pago: t.tipo_pago || 'Ambos',
    rango_min: (t.rango_min === '' || t.rango_min === undefined || t.rango_min === null) ? 0 : Number(t.rango_min),
    rango_max: (t.rango_max === '' || t.rango_max === undefined || t.rango_max === null) ? null : Number(t.rango_max),
    costo: (t.costo === '' || t.costo === undefined || t.costo === null) ? 0 : Number(t.costo),
    tiempo_entrega_hs: t.tiempo_entrega_hs ? String(t.tiempo_entrega_hs).trim() : null,
    activo: t.activo !== false,
  };
}

exports.listCouriers = async (req, res) => {
  try {
    const usuario_id = req.usuario.id; // Asumiendo autenticación por token en req.user
    const where = { usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const couriers = await Courier.findAll({
      where,
      include: [{ model: CourierAcceso, as: 'acceso', attributes: ACCESS_ATTRIBUTES, required: false }],
      order: [['nombre', 'ASC'], ['id', 'ASC']],
    });
    res.json(couriers);
  } catch (error) {
    console.error('Error listing couriers:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getAccesoCourier = async (req, res) => {
  const usuario_id = req.usuario.id;
  const courier = await courierDelUsuario(req.params.id, usuario_id, req.usuario.tiendaId);
  if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

  const acceso = await CourierAcceso.findOne({
    where: { courier_id: courier.id, usuario_id },
    attributes: ACCESS_ATTRIBUTES,
  });
  res.json(accesoSeguro(acceso));
};

exports.createAccesoCourier = async (req, res) => {
  const usuario_id = req.usuario.id;
  const courier = await courierDelUsuario(req.params.id, usuario_id, req.usuario.tiendaId);
  if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

  const username = usernameLimpio(req.body?.username);
  const password = String(req.body?.password || '');
  const confirmPassword = req.body?.confirm_password !== undefined ? String(req.body.confirm_password || '') : password;
  const activo = req.body?.activo === undefined ? true : !!req.body.activo;

  if (!username) return res.status(400).json({ error: 'El usuario de acceso es obligatorio.' });
  const passwordError = validarPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });

  const existenteCourier = await CourierAcceso.findOne({ where: { courier_id: courier.id } });
  if (existenteCourier) return res.status(409).json({ error: 'Este courier ya tiene acceso creado.' });

  const existenteUsername = await CourierAcceso.findOne({ where: { username } });
  if (existenteUsername) return res.status(409).json({ error: 'Ese usuario ya está en uso.' });

  const password_hash = await bcrypt.hash(password, 10);
  const acceso = await CourierAcceso.create({
    courier_id: courier.id,
    usuario_id,
    username,
    password_hash,
    activo,
  });

  res.status(201).json(accesoSeguro(acceso));
};

exports.updatePasswordAccesoCourier = async (req, res) => {
  const usuario_id = req.usuario.id;
  const courier = await courierDelUsuario(req.params.id, usuario_id, req.usuario.tiendaId);
  if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

  const password = String(req.body?.password || '');
  const confirmPassword = req.body?.confirm_password !== undefined ? String(req.body.confirm_password || '') : password;
  const passwordError = validarPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Las contraseñas no coinciden.' });

  const acceso = await CourierAcceso.findOne({ where: { courier_id: courier.id, usuario_id } });
  if (!acceso) return res.status(404).json({ error: 'Este courier todavía no tiene acceso.' });

  await acceso.update({ password_hash: await bcrypt.hash(password, 10) });
  res.json(accesoSeguro(acceso));
};

exports.updateEstadoAccesoCourier = async (req, res) => {
  const usuario_id = req.usuario.id;
  const courier = await courierDelUsuario(req.params.id, usuario_id, req.usuario.tiendaId);
  if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

  const acceso = await CourierAcceso.findOne({ where: { courier_id: courier.id, usuario_id } });
  if (!acceso) return res.status(404).json({ error: 'Este courier todavía no tiene acceso.' });

  await acceso.update({ activo: !!req.body?.activo });
  res.json(accesoSeguro(acceso));
};

exports.createCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nombre, telefono, vehiculo, activo } = req.body;

    const courier = await Courier.create({
      usuario_id,
      tienda_id: req.usuario.tiendaId || null,
      nombre,
      telefono,
      vehiculo,
      activo,
    });

    res.status(201).json(courier);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Error creating courier:', error);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
};

exports.updateCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { nombre, telefono, vehiculo, activo } = req.body;

    const where = { id, usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const courier = await Courier.findOne({ where });
    if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

    await courier.update({
      nombre,
      telefono,
      vehiculo,
      activo,
    });

    res.json(courier);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Error updating courier:', error);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
};

exports.deleteCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const where = { id, usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const courier = await Courier.findOne({ where });
    if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

    await courier.destroy();
    res.json({ success: true, message: 'Courier eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting courier:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.listZonasDelivery = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    res.json(await zonasDelUsuario(usuario_id, req.usuario.tiendaId));
  } catch (error) {
    console.error('Error listing delivery zones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.catalogoGeografico = async (req, res) => {
  try {
    const conCiudades = req.body?.conCiudades === true || req.body?.conCiudades === 1 || req.body?.conCiudades === '1';
    res.json(await RedFulfillmentService.catalogoGeografico({ conCiudades }));
  } catch (error) {
    console.error('Error listing courier geography catalog:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * Reemplaza las tarifas del comercio.
 *
 * `courierIds` acota el alcance del reemplazo: el cliente declara de qué
 * couriers es autoritativo y sólo esas reglas se borran y se vuelven a
 * escribir. Sin ese alcance el endpoint borra TODAS las del usuario y
 * reescribe lo que llegue, que es el comportamiento histórico: funciona
 * mientras el panel mande siempre el set completo, pero cualquier payload
 * parcial —una pestaña vieja, un cliente futuro que edite un solo courier—
 * se lleva puestas las tarifas de los demás.
 *
 * Toda regla necesita un courier. Antes se aceptaban reglas sueltas —sin
 * courier asignado— y `courierIds: []` significaba "sólo esas". Una regla sin
 * courier da un precio que nadie está asignado a cumplir, y la invariante de
 * la tabla (`delivery_zona_tarifas_dueno_check`) ahora lo prohíbe: una regla
 * es del comercio (usuario + courier) o de la red (proveedor + centro).
 */
exports.replaceZonasDelivery = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const tiendaId = req.usuario.tiendaId;
    const zonas = Array.isArray(req.body?.zonas) ? req.body.zonas : [];
    const whereCouriers = { usuario_id };
    if (tiendaId) whereCouriers.tienda_id = tiendaId;
    const couriers = await Courier.findAll({ where: whereCouriers, attributes: ['id'] });
    const couriersPermitidos = new Set(couriers.map(c => Number(c.id)));
    const normalizadas = zonas
      .map(z => normalizarZonaDelivery(z, usuario_id, couriersPermitidos))
      .filter(z => z.ciudad);

    const sinCourier = normalizadas.filter(z => z.courier_id === null);
    if (sinCourier.length > 0) {
      return res.status(400).json({
        error: 'Cada tarifa tiene que estar asignada a un courier tuyo.',
      });
    }

    const conAlcance = Array.isArray(req.body?.courierIds);
    const alcance = conAlcance
      ? [...new Set(req.body.courierIds.map(Number).filter(id => couriersPermitidos.has(id)))]
      : null;

    if (conAlcance) {
      // Una regla fuera del alcance declarado no se guarda: si entrara, el
      // borrado acotado no la alcanzaría nunca y quedaría duplicada.
      const fuera = normalizadas.filter(z => !alcance.includes(z.courier_id));
      if (fuera.length > 0) {
        return res.status(400).json({
          error: 'Hay reglas de couriers que no están en el alcance declarado del guardado.',
        });
      }
    }

    const whereBorrado = { usuario_id };
    if (conAlcance) {
      if (alcance.length === 0) {
        // Alcance vacío: no hay nada de qué el cliente sea autoritativo.
        return res.json(await zonasDelUsuario(usuario_id, tiendaId));
      }
      whereBorrado.courier_id = { [Op.in]: alcance };
    } else if (tiendaId) {
      // Sin alcance declarado, el borrado histórico era "todo lo del
      // usuario" — con 2+ tiendas eso borraría también las tarifas de OTRA
      // tienda. Se acota a los couriers de la tienda activa (los únicos que
      // `couriersPermitidos` dejó pasar en `normalizadas`).
      whereBorrado.courier_id = { [Op.in]: [...couriersPermitidos] };
    }

    await sequelize.transaction(async (t) => {
      await DeliveryZonaTarifa.destroy({ where: whereBorrado, transaction: t });
      if (normalizadas.length > 0) {
        await DeliveryZonaTarifa.bulkCreate(normalizadas, { transaction: t });
      }
    });

    res.json(await zonasDelUsuario(usuario_id, tiendaId));
  } catch (error) {
    console.error('Error replacing delivery zones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
envolverControlador(module.exports);

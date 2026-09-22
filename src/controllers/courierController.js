const { Op } = require('sequelize');
const { sequelize, Courier, DeliveryZonaTarifa } = require('../models');
const { envolverControlador } = require('../utils/asyncHandler');

/** Las tarifas del comercio, tal como las consumen el listado y el guardado. */
function zonasDelUsuario(usuario_id) {
  return DeliveryZonaTarifa.findAll({
    where: { usuario_id },
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
  return {
    usuario_id: usuarioId,
    courier_id: courierId && couriersPermitidos.has(courierId) ? courierId : null,
    departamento: t.departamento ? String(t.departamento).trim() : null,
    ciudad: String(t.ciudad || t.ciudad_zona || '').trim(),
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
    const couriers = await Courier.findAll({ where: { usuario_id } });
    res.json(couriers);
  } catch (error) {
    console.error('Error listing couriers:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.createCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nombre, telefono, vehiculo, activo } = req.body;

    const courier = await Courier.create({
      usuario_id,
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

    const courier = await Courier.findOne({ where: { id, usuario_id } });
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

    const courier = await Courier.findOne({ where: { id, usuario_id } });
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
    res.json(await zonasDelUsuario(usuario_id));
  } catch (error) {
    console.error('Error listing delivery zones:', error);
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
    const zonas = Array.isArray(req.body?.zonas) ? req.body.zonas : [];
    const couriers = await Courier.findAll({ where: { usuario_id }, attributes: ['id'] });
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
        return res.json(await zonasDelUsuario(usuario_id));
      }
      whereBorrado.courier_id = { [Op.in]: alcance };
    }

    await sequelize.transaction(async (t) => {
      await DeliveryZonaTarifa.destroy({ where: whereBorrado, transaction: t });
      if (normalizadas.length > 0) {
        await DeliveryZonaTarifa.bulkCreate(normalizadas, { transaction: t });
      }
    });

    res.json(await zonasDelUsuario(usuario_id));
  } catch (error) {
    console.error('Error replacing delivery zones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
envolverControlador(module.exports);

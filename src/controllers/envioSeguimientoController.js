'use strict';

/**
 * Acciones de seguimiento de WhatsApp ESCOPADAS A UN PEDIDO puntual (RF
 * Seguimiento de pedidos por WhatsApp). Las acciones que no dependen de un
 * pedido (CRUD de plantillas/etiquetas, configuración, notificaciones)
 * viven en seguimientoController.js.
 */
const { Op, Transaction, UniqueConstraintError } = require('sequelize');
const {
  sequelize, Envio, EnvioItem, EnvioHistorial,
  WhatsappPlantilla, WhatsappFlujo, WhatsappFlujoFase,
  SeguimientoEtiqueta, EnvioEtiqueta,
  SeguimientoContacto, SeguimientoRecordatorio, SeguimientoConfiguracion,
} = require('../models');
const flujoService = require('../services/seguimiento/flujo.service');
const { registrarHistorial } = require('../utils/historial');
const { resolverMensaje } = require('../services/seguimiento/plantillaResolver.service');
const { encolarRecordatorio } = require('../services/queue/seguimientoQueue');
const { logger } = require('../utils/logger');
const { envolverControlador } = require('../utils/asyncHandler');

function esAdministrador(req) {
  return req.usuario?.rol === 'administrador';
}

function filtroEnvio(req, id) {
  return esAdministrador(req) ? { id } : { id, usuario_id: req.usuario.id };
}

function normalizarTelefono(telefono) {
  // Remove everything except digits and leading +
  let t = String(telefono || '').trim();
  // If already has country code (starts with + or 595...), strip non-digits and use as-is
  if (t.startsWith('+')) {
    return t.replace(/\D/g, '');
  }
  const soloDigitos = t.replace(/\D/g, '');
  // Paraguay numbers: local format starts with 09xxxxxxxx (10 digits) or 9xxxxxxxx (9 digits)
  if (soloDigitos.startsWith('0') && soloDigitos.length >= 9) {
    return '595' + soloDigitos.slice(1);
  }
  // If already has 595 prefix
  if (soloDigitos.startsWith('595')) {
    return soloDigitos;
  }
  // Default: assume Paraguay, prepend 595
  if (soloDigitos.length <= 9) {
    return '595' + soloDigitos;
  }
  return soloDigitos;
}

function whatsappUrl(telefono, mensaje) {
  const numero = normalizarTelefono(telefono);
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

async function cargarEnvioODevolver404(req, res, { conItems = false } = {}) {
  const { id } = req.params;
  const envio = await Envio.findOne({
    where: filtroEnvio(req, id),
    include: conItems ? [{ model: EnvioItem, as: 'items' }] : [],
  });
  if (!envio) {
    res.status(404).json({ error: 'Pedido no encontrado' });
    return null;
  }
  return envio;
}

/**
 * GET /api/envios/:id/seguimiento/flujos — flujos activos del usuario con
 * lo que ya pasó con cada fase EN ESTE PEDIDO (cuántas veces se abrió y
 * cuándo fue la última). Es lo único que el panel del pedido necesita para
 * dibujar el flujo: no hay "fase actual" guardada, se deriva del historial.
 */
exports.flujosDelPedido = async (req, res) => {
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;
  const flujos = await flujoService.estadoFlujosDelPedido(envio.id, {
    usuarioId: req.usuario.id,
    esAdmin: esAdministrador(req),
  });
  res.json(flujos);
};

/**
 * POST /api/envios/:id/seguimiento/contactos — Registra que el usuario
 * ABRIÓ EN WHATSAPP una fase del flujo (BE-06). Devuelve el mensaje ya
 * resuelto y el enlace wa.me listo para abrir; el frontend no necesita
 * saber cómo se construye ninguno de los dos.
 *
 * Ojo con el nombre: esto no registra un mensaje enviado. Con un deep link
 * wa.me no hay forma de saber si el operador apretó enviar, así que el
 * contacto queda en estado ABIERTO_EN_WHATSAPP. Contarlos como "mensajes
 * enviados" sería un dato falso.
 *
 * Una fase no se consume: reenviar la Fase 1 diez veces son diez contactos
 * con el mismo fase_id, y está bien. Acá no se valida ningún orden.
 *
 * Body: { fase_id } (nuevo), { plantilla_id } (legacy) o { mensaje } libre.
 *
 * Efectos automáticos (BE-05/BE-07):
 *  - Si la fase tiene etiqueta asociada, se aplica al pedido.
 *  - Si el pedido está "Pendiente", pasa a "EnSeguimiento" (solo la
 *    PRIMERA vez — los contactos siguientes no vuelven a mover el estado).
 */
exports.registrarContacto = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { fase_id, plantilla_id, telefono: telefonoOverride } = req.body;

  try {
    const envio = await cargarEnvioODevolver404(req, res, { conItems: true });
    if (!envio) return;

    let fase = null;
    let plantilla = null;
    let mensajeBase;
    if (fase_id) {
      fase = await WhatsappFlujoFase.findOne({
        where: { id: fase_id },
        include: [{
          model: WhatsappFlujo,
          as: 'flujo',
          required: true,
          where: esAdministrador(req) ? {} : { usuario_id },
        }],
      });
      if (!fase) return res.status(404).json({ error: 'Fase no encontrada' });
      mensajeBase = fase.mensaje;
    } else if (plantilla_id) {
      plantilla = await WhatsappPlantilla.findOne({
        where: esAdministrador(req) ? { id: plantilla_id } : { id: plantilla_id, usuario_id },
      });
      if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });
      mensajeBase = plantilla.mensaje;
    } else {
      mensajeBase = req.body.mensaje;
      if (!mensajeBase || !String(mensajeBase).trim()) {
        return res.status(400).json({ error: 'Se requiere fase_id, plantilla_id o mensaje' });
      }
    }

    const telefono = telefonoOverride || envio.telefono;
    if (!telefono) return res.status(400).json({ error: 'El pedido no tiene teléfono registrado' });

    const mensajeResuelto = resolverMensaje(mensajeBase, envio);

    const etiquetaAutomatica = fase?.etiqueta_id || plantilla?.etiqueta_id || null;

    const resultado = await sequelize.transaction(async (t) => {
      const contacto = await SeguimientoContacto.create({
        envio_id: envio.id,
        flujo_id: fase?.flujo_id || null,
        fase_id: fase?.id || null,
        plantilla_id: plantilla?.id || null,
        etiqueta_id: etiquetaAutomatica,
        usuario_id,
        telefono,
        mensaje_generado: mensajeResuelto,
        canal: 'WHATSAPP',
        estado: 'ABIERTO_EN_WHATSAPP',
      }, { transaction: t });

      let etiquetaAplicada = null;
      if (etiquetaAutomatica) {
        etiquetaAplicada = await aplicarEtiqueta(envio.id, etiquetaAutomatica, usuario_id, fase ? 'fase' : 'plantilla', t);
      }

      let transicionAutomatica = false;
      if (envio.estado === 'Pendiente') {
        await envio.update({ estado: 'EnSeguimiento' }, { transaction: t });
        await registrarHistorial(envio.id, usuario_id, 'Pendiente → EnSeguimiento (primer contacto de WhatsApp)', t);
        transicionAutomatica = true;
      }

      // Cuántas veces se abrió ya esta fase en este pedido, incluyendo la de
      // ahora: el historial dice "reenviada (3er intento)" en vez de repetir
      // la misma línea sin contexto.
      let intento = 1;
      if (fase) {
        intento = await SeguimientoContacto.count({
          where: { envio_id: envio.id, fase_id: fase.id },
          transaction: t,
        });
      }

      let detalleHistorial;
      if (fase) {
        const sufijo = intento > 1 ? ` — reenviada (intento ${intento})` : '';
        detalleHistorial = `WhatsApp abierto — ${fase.flujo.nombre} · Fase ${fase.orden}: ${fase.nombre}${sufijo}`;
      } else if (plantilla) {
        detalleHistorial = `Contacto WhatsApp — Plantilla "${plantilla.nombre}"`;
      } else {
        detalleHistorial = 'Contacto WhatsApp — mensaje libre';
      }
      await registrarHistorial(envio.id, usuario_id, detalleHistorial, t);

      return { contacto, etiquetaAplicada, transicionAutomatica, intento };
    });

    res.status(201).json({
      contacto: resultado.contacto,
      etiqueta_aplicada: resultado.etiquetaAplicada,
      pedido_paso_a_en_seguimiento: resultado.transicionAutomatica,
      whatsapp_url: whatsappUrl(telefono, mensajeResuelto),
      // Para que el panel pueda ofrecer el recordatorio de la fase siguiente
      // sin volver a pedir el flujo entero.
      fase: fase ? {
        id: fase.id,
        nombre: fase.nombre,
        orden: fase.orden,
        flujo_id: fase.flujo_id,
        intento: resultado.intento,
      } : null,
    });
  } catch (error) {
    logger.error({ mensaje: '[Seguimiento] Error registrando contacto.', error: error.message });
    res.status(500).json({ error: 'Error al registrar el contacto' });
  }
};

/** GET /api/envios/:id/seguimiento/contactos — historial de contactos de este pedido. */
exports.listarContactos = async (req, res) => {
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;
  const contactos = await SeguimientoContacto.findAll({
    where: { envio_id: envio.id },
    include: [
      {
        model: WhatsappFlujoFase,
        as: 'fase',
        attributes: ['id', 'nombre', 'orden'],
        include: [{ model: WhatsappFlujo, as: 'flujo', attributes: ['id', 'nombre'] }],
      },
      { model: WhatsappPlantilla, as: 'plantilla', attributes: ['id', 'nombre', 'codigo'] },
      { model: SeguimientoEtiqueta, as: 'etiqueta', attributes: ['id', 'nombre', 'codigo'] },
    ],
    order: [['created_at', 'DESC']],
  });
  res.json(contactos);
};

/** Aplica una etiqueta al pedido, sin duplicar si ya está activa. Reutilizado por registrarContacto y asociarEtiqueta. */
async function aplicarEtiqueta(envioId, etiquetaId, usuarioId, origen, t) {
  const yaActiva = await EnvioEtiqueta.findOne({ where: { envio_id: envioId, etiqueta_id: etiquetaId, activa: true }, transaction: t });
  if (yaActiva) return yaActiva;
  return EnvioEtiqueta.create({ envio_id: envioId, etiqueta_id: etiquetaId, usuario_id: usuarioId, origen, activa: true }, { transaction: t });
}

/** GET /api/envios/:id/seguimiento/etiquetas — etiquetas activas del pedido. */
exports.listarEtiquetasDelPedido = async (req, res) => {
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;
  const etiquetas = await EnvioEtiqueta.findAll({
    where: { envio_id: envio.id, activa: true },
    include: [{ model: SeguimientoEtiqueta, as: 'etiqueta' }],
    order: [['created_at', 'DESC']],
  });
  res.json(etiquetas);
};

/** POST /api/envios/:id/seguimiento/etiquetas — asocia manualmente una etiqueta (BE-05). Body: { etiqueta_id }. */
exports.asociarEtiqueta = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { etiqueta_id } = req.body;
  if (!etiqueta_id) return res.status(400).json({ error: 'etiqueta_id es obligatorio' });

  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  const etiqueta = await SeguimientoEtiqueta.findOne({
    where: esAdministrador(req) ? { id: etiqueta_id } : { id: etiqueta_id, usuario_id },
  });
  if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada' });

  const resultado = await sequelize.transaction(async (t) => {
    const asociacion = await aplicarEtiqueta(envio.id, etiqueta.id, usuario_id, 'manual', t);
    await registrarHistorial(envio.id, usuario_id, `Etiqueta "${etiqueta.nombre}" agregada`, t);
    return asociacion;
  });
  res.status(201).json(resultado);
};

/** DELETE /api/envios/:id/seguimiento/etiquetas/:etiquetaId — quita (soft) una etiqueta del pedido. */
exports.quitarEtiqueta = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { etiquetaId } = req.params;

  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  const asociacion = await EnvioEtiqueta.findOne({ where: { envio_id: envio.id, etiqueta_id: etiquetaId, activa: true } });
  if (!asociacion) return res.status(404).json({ error: 'El pedido no tiene esa etiqueta activa' });

  await sequelize.transaction(async (t) => {
    await asociacion.update({ activa: false, removido_en: new Date() }, { transaction: t });
    await registrarHistorial(envio.id, usuario_id, 'Etiqueta removida', t);
  });
  res.status(204).send();
};

/**
 * POST /api/envios/:id/seguimiento/recordatorio — crea o reprograma
 * (BE-08/BE-09/BE-16/BE-23) el próximo seguimiento de este pedido. Solo
 * puede existir UN recordatorio PENDIENTE por pedido a la vez: si ya había
 * uno, este endpoint lo reprograma (mismo registro, version+1) en vez de
 * crear uno nuevo — así es como el RF describe "reprogramación".
 *
 * Body: { ejecutar_en: ISO8601 } o { horas: number } (atajo para "dentro de N horas", BE-09).
 */
exports.programarRecordatorio = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { ejecutar_en, horas, nota } = req.body;

  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  let fechaEjecucion;
  if (horas !== undefined) {
    fechaEjecucion = new Date(Date.now() + Number(horas) * 60 * 60 * 1000);
  } else if (ejecutar_en) {
    fechaEjecucion = new Date(ejecutar_en);
  }
  if (!fechaEjecucion || isNaN(fechaEjecucion.getTime())) {
    return res.status(400).json({ error: 'Se requiere ejecutar_en (fecha/hora) u horas (atajo)' });
  }
  if (fechaEjecucion.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'La fecha del recordatorio debe ser futura' });
  }

  try {
    const recordatorio = await sequelize.transaction(async (t) => {
      const existente = await SeguimientoRecordatorio.findOne({
        where: { envio_id: envio.id, estado: 'PENDIENTE' },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });

      let fila;
      if (existente) {
        fila = existente;
        await fila.update({
          usuario_id, ejecutar_en: fechaEjecucion, nota: nota ?? fila.nota, version: fila.version + 1,
        }, { transaction: t });
        await registrarHistorial(envio.id, usuario_id, `Seguimiento reprogramado para ${fechaEjecucion.toLocaleString('es-PY')}`, t);
      } else {
        fila = await SeguimientoRecordatorio.create({
          envio_id: envio.id, usuario_id, ejecutar_en: fechaEjecucion, nota: nota || null,
        }, { transaction: t });
        await registrarHistorial(envio.id, usuario_id, `Seguimiento programado para ${fechaEjecucion.toLocaleString('es-PY')}`, t);
      }

      return fila;
    });

    await encolarRecordatorio(recordatorio);
    res.status(201).json(recordatorio);
  } catch (error) {
    logger.error({ mensaje: '[Seguimiento] Error programando recordatorio.', error: error.message });
    res.status(500).json({ error: 'Error al programar el recordatorio' });
  }
};

/** PATCH /api/envios/:id/seguimiento/recordatorio/:recordatorioId/completar — el responsable marca el seguimiento como hecho antes de que venza. */
exports.completarRecordatorio = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { recordatorioId } = req.params;
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  let recordatorio = await SeguimientoRecordatorio.findOne({ where: { id: recordatorioId, envio_id: envio.id, estado: 'PENDIENTE' } });
  if (!recordatorio) {
    recordatorio = await SeguimientoRecordatorio.findOne({ where: { envio_id: envio.id, estado: 'PENDIENTE' } });
  }
  if (!recordatorio) return res.status(404).json({ error: 'Recordatorio pendiente no encontrado' });

  await sequelize.transaction(async (t) => {
    await recordatorio.update({ estado: 'COMPLETADO', completado_en: new Date() }, { transaction: t });
    await registrarHistorial(envio.id, usuario_id, 'Seguimiento marcado como completado', t);
  });
  res.json(recordatorio);
};

/** PATCH /api/envios/:id/seguimiento/recordatorio/:recordatorioId/cancelar */
exports.cancelarRecordatorio = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { recordatorioId } = req.params;
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  let recordatorio = await SeguimientoRecordatorio.findOne({ where: { id: recordatorioId, envio_id: envio.id, estado: 'PENDIENTE' } });
  if (!recordatorio) {
    recordatorio = await SeguimientoRecordatorio.findOne({ where: { envio_id: envio.id, estado: 'PENDIENTE' } });
  }
  if (!recordatorio) return res.status(404).json({ error: 'Recordatorio pendiente no encontrado' });

  await sequelize.transaction(async (t) => {
    await recordatorio.update({ estado: 'CANCELADO', cancelado_en: new Date() }, { transaction: t });
    await registrarHistorial(envio.id, usuario_id, 'Seguimiento cancelado', t);
  });
  res.json(recordatorio);
};

/**
 * GET /api/envios/:id/seguimiento/historial — timeline cronológica del
 * pedido (BE-11): mezcla el historial general (EnvioHistorial, que ya
 * registra cada acción de seguimiento vía registrarHistorial más arriba)
 * con el detalle de contactos y recordatorios, para que el frontend pueda
 * mostrar tanto el resumen como el detalle sin pegarle a 3 endpoints.
 */
exports.historialSeguimiento = async (req, res) => {
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;

  const [historial, contactos, recordatorios, etiquetas] = await Promise.all([
    EnvioHistorial.findAll({ where: { envio_id: envio.id }, order: [['created_at', 'ASC']] }),
    SeguimientoContacto.findAll({
      where: { envio_id: envio.id },
      include: [
        {
          model: WhatsappFlujoFase,
          as: 'fase',
          attributes: ['id', 'nombre', 'orden'],
          include: [{ model: WhatsappFlujo, as: 'flujo', attributes: ['id', 'nombre'] }],
        },
        { model: WhatsappPlantilla, as: 'plantilla', attributes: ['id', 'nombre'] },
        { model: SeguimientoEtiqueta, as: 'etiqueta', attributes: ['id', 'nombre'] },
      ],
      order: [['created_at', 'ASC']],
    }),
    SeguimientoRecordatorio.findAll({ where: { envio_id: envio.id }, order: [['created_at', 'ASC']] }),
    EnvioEtiqueta.findAll({ where: { envio_id: envio.id }, include: [{ model: SeguimientoEtiqueta, as: 'etiqueta' }], order: [['created_at', 'ASC']] }),
  ]);

  const eventos = [
    ...historial.map((h) => ({ tipo: 'HISTORIAL', fecha: h.created_at, detalle: h.detalle })),
    ...contactos.map((c) => {
      let detalle;
      if (c.fase) {
        detalle = `WhatsApp abierto — ${c.fase.flujo?.nombre || 'Flujo'} · Fase ${c.fase.orden}: ${c.fase.nombre}`;
      } else if (c.plantilla) {
        detalle = `Contacto — Plantilla "${c.plantilla.nombre}"`;
      } else {
        detalle = 'Contacto — mensaje libre';
      }
      return {
        tipo: 'CONTACTO_WHATSAPP',
        fecha: c.created_at,
        detalle,
        // ABIERTO_EN_WHATSAPP: se abrio el deep link, no hay confirmacion de entrega.
        estado: c.estado,
        flujo: c.fase?.flujo?.nombre || null,
        fase: c.fase ? { id: c.fase.id, nombre: c.fase.nombre, orden: c.fase.orden } : null,
        etiqueta: c.etiqueta?.nombre || null,
        telefono: c.telefono,
      };
    }),
    ...recordatorios.flatMap((r) => {
      const puntos = [{ tipo: 'SEGUIMIENTO_PROGRAMADO', fecha: r.created_at, detalle: `Seguimiento programado para ${new Date(r.ejecutar_en).toLocaleString('es-PY')}` }];
      if (r.estado === 'VENCIDO') puntos.push({ tipo: 'SEGUIMIENTO_VENCIDO', fecha: r.ejecutar_en, detalle: 'Seguimiento vencido, requiere atención' });
      if (r.completado_en) puntos.push({ tipo: 'SEGUIMIENTO_COMPLETADO', fecha: r.completado_en, detalle: 'Seguimiento completado' });
      if (r.cancelado_en) puntos.push({ tipo: 'SEGUIMIENTO_CANCELADO', fecha: r.cancelado_en, detalle: 'Seguimiento cancelado' });
      return puntos;
    }),
    ...etiquetas.map((e) => ({ tipo: 'ETIQUETA', fecha: e.created_at, detalle: `Etiqueta "${e.etiqueta?.nombre}" agregada (${e.origen})` })),
  ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  res.json(eventos);
};

/** POST /api/envios/:id/seguimiento/nota - Guarda una nota libre en el historial del pedido sin agendar recordatorio. */
exports.guardarNota = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nota } = req.body;
  if (!nota || !String(nota).trim()) {
    return res.status(400).json({ error: 'La nota no puede estar vacia' });
  }
  const envio = await cargarEnvioODevolver404(req, res);
  if (!envio) return;
  try {
    await registrarHistorial(envio.id, usuario_id, `Nota: ${nota.trim()}`);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar nota' });
  }
};

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
envolverControlador(module.exports);

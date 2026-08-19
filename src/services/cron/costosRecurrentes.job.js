'use strict';

const cron = require('node-cron');
const { Op } = require('sequelize');
const { CostoGasto } = require('../../models');
const { calcularProximaFecha } = require('../costoGasto.service');
const { logger } = require('../../utils/logger');

/**
 * Genera las ocurrencias de costos/gastos recurrentes cuya proxima_fecha ya
 * llegó. Cada plantilla (es_recurrente=true, parent_recurring_id=null,
 * activo=true) produce una fila hija independiente (parent_recurring_id
 * apuntando a la plantilla) y luego avanza su propia proxima_fecha.
 *
 * Idempotente por diseño: una vez generada la ocurrencia de una fecha,
 * proxima_fecha de la plantilla queda en el futuro, así que no se puede
 * duplicar aunque el job corra más de una vez el mismo día.
 */
async function generarOcurrenciasRecurrentes() {
  const hoy = new Date().toISOString().slice(0, 10);

  const plantillas = await CostoGasto.findAll({
    where: {
      es_recurrente: true,
      parent_recurring_id: null,
      activo: true,
      proxima_fecha: { [Op.lte]: hoy },
    },
  });

  for (const plantilla of plantillas) {
    try {
      await CostoGasto.create({
        usuario_id: plantilla.usuario_id,
        tipo: plantilla.tipo,
        categoria_id: plantilla.categoria_id,
        concepto: plantilla.concepto,
        descripcion: plantilla.descripcion,
        importe: plantilla.importe,
        moneda: plantilla.moneda,
        fecha: plantilla.proxima_fecha,
        fecha_pago: null,
        estado: 'pendiente',
        clasificacion: plantilla.clasificacion,
        es_recurrente: false,
        frecuencia: null,
        proxima_fecha: null,
        parent_recurring_id: plantilla.id,
        metodo_pago_id: plantilla.metodo_pago_id,
        proveedor_id: plantilla.proveedor_id,
        producto_id: plantilla.producto_id,
        variante_id: plantilla.variante_id,
        envio_id: null,
      });

      plantilla.proxima_fecha = calcularProximaFecha(plantilla.proxima_fecha, plantilla.frecuencia);
      await plantilla.save();
    } catch (err) {
      logger.error(`[costosRecurrentes] Error generando ocurrencia de la plantilla #${plantilla.id}:`, err);
    }
  }

  if (plantillas.length > 0) {
    logger.info(`[costosRecurrentes] ${plantillas.length} ocurrencia(s) de gastos recurrentes generada(s).`);
  }
}

/** Corre todos los días a las 03:00 — horario de bajo tráfico. */
function iniciarJobCostosRecurrentes() {
  cron.schedule('0 3 * * *', () => {
    generarOcurrenciasRecurrentes().catch(err => logger.error('[costosRecurrentes] Error en el job:', err));
  });
}

module.exports = { iniciarJobCostosRecurrentes, generarOcurrenciasRecurrentes };

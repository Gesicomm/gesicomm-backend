'use strict';

const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize, PagoSuscripcion } = require('../../models');
const SuscripcionService = require('../suscripcion.service');
const { logger } = require('../../utils/logger');

/**
 * Segunda línea de defensa contra un webhook de PagoPar perdido.
 *
 * PagoPar reintenta el callback cada 10 minutos hasta recibir 200
 * (confirmado contra su documentación oficial, ver
 * soporte.pagopar.com/portal/es/kb/articles/api-integracion-medios-pagos),
 * pero no hay garantía documentada de un tope máximo de reintentos, y de
 * todas formas cubre solo fallas del lado de Gesicom — no una URL de
 * callback mal configurada, un firewall, o un bug que responda 200 sin
 * procesar nada. Por eso barre los PagoSuscripcion en PENDING viejos y
 * reconsulta directo contra PagoPar, usando la misma
 * `consultarYReconciliarPagoPorHash` que ya usan el webhook y la pantalla
 * de resultado — nada nuevo ahí, solo un disparador adicional.
 *
 * Ventana de gracia de 15 minutos antes de considerar un PENDING
 * "candidato": evita pisarle el webhook normal a un pago que recién se
 * inició. No es polling agresivo: corre cada 15 minutos.
 *
 * Seguro con múltiples instancias del backend sin agregar infraestructura:
 * usa `pg_try_advisory_xact_lock`, un lock de Postgres con alcance a la
 * transacción (se libera solo al hacer COMMIT/ROLLBACK, sin necesidad de
 * fijar la conexión a mano). Si otra instancia ya está corriendo el mismo
 * barrido, esta simplemente no hace nada y lo reintenta en el próximo tick
 * — no hace falta que las instancias se coordinen entre sí.
 *
 * (La corrección de cada pago individual ya es idempotente de por sí vía
 * `acreditarPago`, con `SELECT ... FOR UPDATE` — este lock no protege eso,
 * que ya está protegido; protege contra que 2-5 instancias le disparen la
 * misma consulta a PagoPar al mismo tiempo, sin ninguna ganancia y
 * arriesgando un límite de tasa de la pasarela.)
 */
const VENTANA_GRACIA_MS = 15 * 60 * 1000;
const LOCK_KEY = 84271001; // arbitrario, fijo — identifica este job entre los advisory locks de Postgres.

async function reconciliarPagosPendientes() {
  await sequelize.transaction(async (t) => {
    const [[{ lock_obtenido }]] = await sequelize.query(
      'SELECT pg_try_advisory_xact_lock(:key) AS lock_obtenido',
      { replacements: { key: LOCK_KEY }, transaction: t },
    );
    if (!lock_obtenido) {
      logger.info('[reconciliacionSuscripciones] Otra instancia ya está corriendo el barrido, se salta este tick.');
      return;
    }

    const limite = new Date(Date.now() - VENTANA_GRACIA_MS);
    const pendientes = await PagoSuscripcion.findAll({
      where: {
        estado: 'PENDING',
        hash_pedido: { [Op.ne]: null },
        created_at: { [Op.lt]: limite },
      },
      transaction: t,
    });

    if (!pendientes.length) return;

    logger.info(`[reconciliacionSuscripciones] Reconciliando ${pendientes.length} pago(s) pendiente(s).`);
    for (const pago of pendientes) {
      try {
        await SuscripcionService.consultarYReconciliarPagoPorHash(pago.hash_pedido, {
          origen: 'Cron de reconciliación',
        });
      } catch (err) {
        // Un pago que falla no debe frenar el resto del lote.
        logger.error(`[reconciliacionSuscripciones] Error reconciliando hash ${pago.hash_pedido}:`, err);
      }
    }
  });
}

/** Corre cada 15 minutos. */
function iniciarJobReconciliacionSuscripciones() {
  cron.schedule('*/15 * * * *', () => {
    reconciliarPagosPendientes().catch(err => logger.error('[reconciliacionSuscripciones] Error en el job:', err));
  });
}

module.exports = { iniciarJobReconciliacionSuscripciones, reconciliarPagosPendientes, LOCK_KEY };

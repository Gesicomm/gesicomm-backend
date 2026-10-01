'use strict';

/**
 * Telemetría de generación IA — una fila por cada llamada a
 * crearDesdeIA/regenerarConIA (ver aiLanding.service.js): qué prompts
 * fallan, cuántos repairs se usan, latencia y costo (tokens) por
 * generación. Nunca debe romper el flujo principal: si guardar el log
 * falla, se loguea el error y se sigue — perder una fila de telemetría no
 * puede tirar abajo la generación real de una landing.
 */
const { AiGenerationLog } = require('../models');

class AiGenerationLogService {
  static async registrar(datos) {
    try {
      await AiGenerationLog.create({
        tienda_id: datos.tiendaId,
        landing_id: datos.landingId ?? null,
        operacion: datos.operacion,
        page_type: datos.pageType,
        target: datos.target ?? null,
        content_id: datos.contentId ?? null,
        prompt: datos.prompt,
        modelo: datos.modelo ?? null,
        latencia_ms: datos.latenciaMs ?? null,
        tokens_input: datos.tokensInput ?? null,
        tokens_output: datos.tokensOutput ?? null,
        repair_used: !!datos.repairUsed,
        exitoso: !!datos.exitoso,
        validation_errors: datos.validationErrors?.length ? datos.validationErrors : null,
        validation_errors_pre_repair: datos.validationErrorsPreRepair?.length ? datos.validationErrorsPreRepair : null,
        metadata: datos.metadata && Object.keys(datos.metadata).length ? datos.metadata : null,
      });
    } catch (err) {
      console.error('[AiGenerationLog] no se pudo guardar el log:', err.message);
    }
  }
}

module.exports = AiGenerationLogService;

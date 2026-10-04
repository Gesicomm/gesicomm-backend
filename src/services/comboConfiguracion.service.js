'use strict';

/**
 * Servicio de Configuración Económica de Combos.
 *
 * Gestiona la configuración por tenant de los parámetros económicos
 * utilizados en el motor de cálculo de rentabilidad de combos.
 *
 * Si un tenant no tiene configuración, se crea automáticamente con valores
 * por defecto al primer acceso (findOrCreate). La configuración siempre
 * es visible y editable por el administrador.
 */

const { ComboConfiguracion } = require('../models');

// Valores por defecto definidos en un solo lugar.
// Si el modelo cambia sus defaults, cambia aquí también.
const DEFAULTS = {
  cpa_porcentaje: 20.00,
  costo_envio: 0,
  costo_confirmacion: 0,
  costo_empaque: 0,
  raha_cpa_porcentaje: 20.00,
  raha_costo_envio: 0,
  raha_costo_confirmacion: 0,
  raha_costo_empaque: 0,
  margenes_objetivo: [15, 30, 45],
  margen_minimo: 10.00,
  umbral_excelente: 50.00,
  escenarios_descuento: [0, 5, 10, 15, 20, 25, 30, 35],
};

class ComboConfiguracionService {

  /**
   * Obtiene la configuración del tenant. Si no existe, la crea con valores
   * por defecto y la retorna. Garantiza que siempre existe un registro.
   *
   * @param {number} inquilino_id
   * @returns {Promise<ComboConfiguracion>}
   */
  static async obtenerOCrear(inquilino_id) {
    const [config] = await ComboConfiguracion.findOrCreate({
      where: { inquilino_id },
      defaults: { ...DEFAULTS, inquilino_id },
    });
    return config;
  }

  /**
   * Actualiza la configuración del tenant.
   * Si no existe, la crea primero.
   * Solo actualiza los campos que vienen en el payload.
   *
   * @param {number} inquilino_id
   * @param {object} datos - Campos a actualizar (parcial)
   * @returns {Promise<ComboConfiguracion>}
   */
  static async actualizar(inquilino_id, datos) {
    const config = await this.obtenerOCrear(inquilino_id);

    // Solo campos permitidos (whitelist explícita)
    const camposPermitidos = [
      'cpa_porcentaje',
      'costo_envio',
      'costo_confirmacion',
      'costo_empaque',
      'raha_cpa_porcentaje',
      'raha_costo_envio',
      'raha_costo_confirmacion',
      'raha_costo_empaque',
      'margenes_objetivo',
      'margen_minimo',
      'umbral_excelente',
      'escenarios_descuento',
    ];

    const update = {};
    for (const campo of camposPermitidos) {
      if (datos[campo] !== undefined) {
        update[campo] = datos[campo];
      }
    }

    if (Object.keys(update).length === 0) {
      return config; // Nada que actualizar
    }

    await config.update(update);
    return config;
  }

  /**
   * Convierte el modelo DB al DTO que espera el motor de cálculo.
   * Permite cambios en la nomenclatura del modelo sin romper el motor.
   *
   * @param {ComboConfiguracion} config
   * @returns {object} DTO para comboPricing.calcular()
   */
  static toMotorCosts(config) {
    return {
      cpaPercentage: parseFloat(config.cpa_porcentaje),
      shipping: parseFloat(config.costo_envio),
      confirmation: parseFloat(config.costo_confirmacion),
      packaging: parseFloat(config.costo_empaque),
    };
  }

  static toRahaMotorCosts(config) {
    return {
      cpaPercentage: parseFloat(config.raha_cpa_porcentaje ?? config.cpa_porcentaje),
      shipping: parseFloat(config.raha_costo_envio ?? config.costo_envio),
      confirmation: parseFloat(config.raha_costo_confirmacion ?? config.costo_confirmacion),
      packaging: parseFloat(config.raha_costo_empaque ?? config.costo_empaque),
    };
  }
}

module.exports = ComboConfiguracionService;

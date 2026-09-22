'use strict';

/**
 * Faltaba representar un tramo real de la operación:
 *
 *   Proveedor → Gesicomm → depósito del comercio
 *
 * El segundo tramo no tenía capacidad propia. `TRASLADO_ENTRE_CENTROS` no
 * sirve, porque el depósito de un comercio NO es un centro de Gesicomm, y
 * `ULTIMA_MILLA` tampoco, porque termina en el comprador final. Son dos
 * destinos distintos y se contratan por separado, así que son dos
 * capacidades distintas.
 *
 * Además `COURIER` como tipo volvía a meter esa palabra en el dominio de la
 * red, que es justo lo que esta separación saca: pasa a
 * `OPERADOR_ULTIMA_MILLA`.
 *
 * Los CHECK se recrean enteros porque Postgres no deja modificarlos en el
 * lugar. No hay backfill: la tabla se creó vacía en la migración anterior.
 */
const CAPACIDADES = [
  'RETIRO_EN_PROVEEDOR',
  'CROSS_DOCKING',
  'ALMACENAMIENTO',
  'TRASLADO_ENTRE_CENTROS',
  'ENTREGA_A_DEPOSITO_COMERCIO',
  'ULTIMA_MILLA',
];

const TIPOS = ['TRANSPORTADORA', 'OPERADOR_ULTIMA_MILLA', 'FLOTA_PROPIA'];

const enLista = (valores) => valores.map((v) => `'${v}'`).join(', ');

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      -- Por si alguna fila quedó con el tipo viejo antes de este cambio.
      UPDATE public.proveedores_logisticos
        SET tipo = 'OPERADOR_ULTIMA_MILLA'
        WHERE tipo = 'COURIER';

      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_tipo_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_tipo_check
        CHECK (tipo IN (${enLista(TIPOS)}));

      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_capacidades_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_capacidades_check
        CHECK (capacidades <@ ARRAY[${enLista(CAPACIDADES)}]::TEXT[]);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.proveedores_logisticos
        SET capacidades = array_remove(capacidades, 'ENTREGA_A_DEPOSITO_COMERCIO');
      UPDATE public.proveedores_logisticos
        SET tipo = 'COURIER' WHERE tipo = 'OPERADOR_ULTIMA_MILLA';

      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_tipo_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_tipo_check
        CHECK (tipo IN ('TRANSPORTADORA', 'COURIER', 'FLOTA_PROPIA'));

      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_capacidades_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_capacidades_check
        CHECK (capacidades <@ ARRAY['RETIRO_EN_PROVEEDOR', 'CROSS_DOCKING', 'ALMACENAMIENTO', 'TRASLADO_ENTRE_CENTROS', 'ULTIMA_MILLA']::TEXT[]);
    `);
  },
};

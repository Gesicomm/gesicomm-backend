'use strict';

/**
 * Verifica la regla de "pérdida de mercadería por producto" del dashboard,
 * sin tocar la base: arma componentes a mano y comprueba el importe.
 *
 * Existe porque el escenario que hay que probar (devoluciones dañadas,
 * unidades perdidas) puede no estar presente en los datos reales, y la
 * regla es justo del tipo que se rompe en silencio: si `devuelta_vendible`
 * se contara como pérdida, nadie lo notaría hasta que un producto sano
 * apareciera dando pérdida.
 *
 * Correr con: node scripts/verificar-perdidas.js
 */

const { perdidaDeItem } = require('../src/services/pedidosAnalyticsService');

const casos = [
  {
    nombre: 'A/B — sin devoluciones ni pérdidas',
    item: { componentes_vendidos: [{ cantidad: 5, costo_unitario: '10000', cantidad_perdida: 0, cantidad_devuelta_danada: 0, cantidad_devuelta_vendible: 0 }] },
    esperado: { unidades: 0, importe: 0 },
  },
  {
    nombre: 'C — devolución VENDIBLE (vuelve al stock, no es pérdida)',
    item: { componentes_vendidos: [{ cantidad: 5, costo_unitario: '10000', cantidad_perdida: 0, cantidad_devuelta_danada: 0, cantidad_devuelta_vendible: 2 }] },
    esperado: { unidades: 0, importe: 0 },
  },
  {
    nombre: 'D — 2 unidades devueltas DAÑADAS a 10.000',
    item: { componentes_vendidos: [{ cantidad: 5, costo_unitario: '10000', cantidad_perdida: 0, cantidad_devuelta_danada: 2, cantidad_devuelta_vendible: 0 }] },
    esperado: { unidades: 2, importe: 20000 },
  },
  {
    nombre: 'E — 3 unidades PERDIDAS a 10.000',
    item: { componentes_vendidos: [{ cantidad: 5, costo_unitario: '10000', cantidad_perdida: 3, cantidad_devuelta_danada: 0, cantidad_devuelta_vendible: 0 }] },
    esperado: { unidades: 3, importe: 30000 },
  },
  {
    nombre: 'Mixto — 2 perdidas + 1 dañada + 1 vendible',
    item: { componentes_vendidos: [{ cantidad: 6, costo_unitario: '10000', cantidad_perdida: 2, cantidad_devuelta_danada: 1, cantidad_devuelta_vendible: 1 }] },
    esperado: { unidades: 3, importe: 30000 },
  },
  {
    nombre: 'Snapshot — dos ventas del mismo producto a costos distintos',
    item: {
      componentes_vendidos: [
        { cantidad: 2, costo_unitario: '10000', cantidad_perdida: 2, cantidad_devuelta_danada: 0, cantidad_devuelta_vendible: 0 },
        { cantidad: 1, costo_unitario: '12000', cantidad_perdida: 0, cantidad_devuelta_danada: 1, cantidad_devuelta_vendible: 0 },
      ],
    },
    esperado: { unidades: 3, importe: 32000 },
  },
  {
    nombre: 'Ítem sin componentes (venta anterior al snapshot)',
    item: {},
    esperado: { unidades: 0, importe: 0 },
  },
];

let fallas = 0;
for (const c of casos) {
  const r = perdidaDeItem(c.item);
  const ok = r.unidades === c.esperado.unidades && r.importe === c.esperado.importe;
  if (!ok) fallas++;
  console.log(
    `${ok ? 'OK  ' : 'FALLA'} ${c.nombre}\n      esperado: ${c.esperado.unidades} u / ${c.esperado.importe} — obtenido: ${r.unidades} u / ${r.importe}`
  );
}

console.log(`\n${fallas === 0 ? 'Todos los casos pasan' : fallas + ' caso(s) fallan'}`);
process.exit(fallas === 0 ? 0 : 1);

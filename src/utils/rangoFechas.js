'use strict';

/**
 * Resolución de rango de fechas por preset — compartido por cualquier
 * endpoint de analítica con filtros dinámicos (pedidosAnalyticsService,
 * landing.service.js estadisticasRango). Un solo lugar para que "Este mes"/
 * "Mes anterior"/etc. signifiquen lo mismo en todos los dashboards.
 */
function resolverRangoFechas(filtros = {}) {
  const hoy = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let { periodo, mes, anio, fecha_desde, fecha_hasta } = filtros;
  const targetAnio = parseInt(anio, 10) || hoy.getFullYear();

  if (fecha_desde && fecha_hasta) {
    return { desde: fecha_desde, hasta: fecha_hasta };
  }

  if (mes) {
    const m = parseInt(mes, 10);
    const primerDia = new Date(targetAnio, m - 1, 1);
    const ultimoDia = new Date(targetAnio, m, 0);
    return { desde: formatYMD(primerDia), hasta: formatYMD(ultimoDia) };
  }

  switch (periodo) {
    case 'hoy': {
      const hoyStr = formatYMD(hoy);
      return { desde: hoyStr, hasta: hoyStr };
    }
    case 'ayer': {
      const ayer = new Date(hoy);
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = formatYMD(ayer);
      return { desde: ayerStr, hasta: ayerStr };
    }
    case '7d': {
      const d7 = new Date(hoy);
      d7.setDate(d7.getDate() - 6);
      return { desde: formatYMD(d7), hasta: formatYMD(hoy) };
    }
    case '30d': {
      const d30 = new Date(hoy);
      d30.setDate(d30.getDate() - 29);
      return { desde: formatYMD(d30), hasta: formatYMD(hoy) };
    }
    case 'mes_anterior': {
      const prevM = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
      const prevY = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
      const primerDia = new Date(prevY, prevM - 1, 1);
      const ultimoDia = new Date(prevY, prevM, 0);
      return { desde: formatYMD(primerDia), hasta: formatYMD(ultimoDia) };
    }
    case 'este_anio': {
      return { desde: `${targetAnio}-01-01`, hasta: `${targetAnio}-12-31` };
    }
    case 'este_mes':
    default: {
      const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      return { desde: formatYMD(primerDia), hasta: formatYMD(ultimoDia) };
    }
  }
}

module.exports = { resolverRangoFechas };

'use strict';

function porcentajeDescuento(antes, ahora) {
  const base = Number(antes), precio = Number(ahora);
  if (!Number.isFinite(base) || !Number.isFinite(precio) || !(base > precio && precio > 0)) return 0;
  const porcentaje = (base - precio) / base * 100;
  const decimales = Math.min(15, Math.max(2, 1 - Math.floor(Math.log10(porcentaje))));
  return Number(porcentaje.toFixed(decimales));
}

module.exports = { porcentajeDescuento };

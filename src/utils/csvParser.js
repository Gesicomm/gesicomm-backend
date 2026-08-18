'use strict';

/**
 * Parser CSV mínimo (RFC 4180): soporta comillas dobles, comas y saltos
 * de línea dentro de campos entrecomillados, y comillas escapadas ("").
 * No es un parser "streaming" — pensado para los reportes de Meta Ads
 * Manager (unos cientos de filas), no para archivos gigantes.
 *
 * No se sumó una dependencia (csv-parse/papaparse) para esto a propósito:
 * es la única necesidad de parseo CSV en el repo hoy, y esta función es
 * chica y autocontenida.
 *
 * @param {string} texto Contenido crudo del archivo (ya decodificado a UTF-8).
 * @returns {{ headers: string[], filas: Record<string,string>[] }}
 */
function parsearCSV(texto) {
  if (!texto || !texto.trim()) return { headers: [], filas: [] };

  // BOM de UTF-8 (frecuente en exports de Meta/Excel)
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);

  const registros = [];
  let campo = '';
  let registro = [];
  let dentroDeComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (dentroDeComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else { dentroDeComillas = false; }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
    } else if (c === ',') {
      registro.push(campo);
      campo = '';
    } else if (c === '\r') {
      // ignorado, \n cierra la línea
    } else if (c === '\n') {
      registro.push(campo);
      campo = '';
      registros.push(registro);
      registro = [];
    } else {
      campo += c;
    }
  }
  // Última línea sin salto final
  if (campo !== '' || registro.length > 0) {
    registro.push(campo);
    registros.push(registro);
  }

  const filasNoVacias = registros.filter(r => !(r.length === 1 && r[0].trim() === ''));
  if (filasNoVacias.length === 0) return { headers: [], filas: [] };

  const headers = filasNoVacias[0].map(h => h.trim());
  const filas = filasNoVacias.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim(); });
    return obj;
  });

  return { headers, filas };
}

module.exports = { parsearCSV };

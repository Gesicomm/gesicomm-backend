'use strict';

const v8 = require('node:v8');

// Solo metadatos primitivos y listas acotadas: nunca retener req/res,
// cuerpos, cookies, queries o resultados de la base en el diagnóstico.
function crearDiagnosticoMemoria({ escribir = console.log, ahora = Date.now, maxActivas = 50, maxRecientes = 10 } = {}) {
  const activas = new Map();
  const recientes = [];
  let secuencia = 0;
  let enCurso = 0;
  const mb = n => Math.round(n / 1024 / 1024);

  function middleware(req, res, next) {
    const id = ++secuencia;
    const inicio = ahora();
    const ruta = String(req.originalUrl || req.url || '').split('?')[0];
    // Las demás rutas se agrupan para evitar publicar tokens de URLs ajenas
    // a las operaciones investigadas.
    const permitida = /^\/api\/(?:l|mis-landings-simples|vitrina|mcp)(?:\/|$)/.test(ruta);
    const registro = { id, metodo: req.method, ruta: permitida ? ruta.slice(0, 180) : '(otra ruta)', inicio };
    enCurso += 1;
    if (activas.size < maxActivas) activas.set(id, registro);
    let terminado = false;
    function terminar() {
      if (terminado) return;
      terminado = true;
      enCurso -= 1;
      activas.delete(id);
      recientes.push({ metodo: registro.metodo, ruta: registro.ruta, estado: res.statusCode, ms: ahora() - inicio, fin: ahora() });
      if (recientes.length > maxRecientes) recientes.shift();
      res.removeListener('finish', terminar);
      res.removeListener('close', terminar);
    }
    res.once('finish', terminar);
    res.once('close', terminar);
    next();
  }

  function muestra() {
    const tiempo = ahora();
    const memoria = process.memoryUsage();
    const contexto = {
      enCurso,
      omitidas: Math.max(0, enCurso - activas.size),
      activas: [...activas.values()].map(({ inicio, ...registro }) => ({ ...registro, ms: tiempo - inicio })),
      recientes: recientes.map(({ fin, ...registro }) => ({ ...registro, haceMs: tiempo - fin })),
    };
    escribir(`[MEM-DEBUG] rss=${mb(memoria.rss)}MB heapUsed=${mb(memoria.heapUsed)}MB heapTotal=${mb(memoria.heapTotal)}MB heapLimit=${mb(v8.getHeapStatistics().heap_size_limit)}MB external=${mb(memoria.external)}MB arrayBuffers=${mb(memoria.arrayBuffers)}MB contexto=${JSON.stringify(contexto)}`);
    return contexto;
  }

  return { middleware, muestra };
}

module.exports = { crearDiagnosticoMemoria };

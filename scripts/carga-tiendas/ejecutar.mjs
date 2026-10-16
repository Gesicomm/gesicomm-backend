import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { validar, rutas } from './modelo.mjs';

const args = process.argv.slice(2);
const opcion = nombre => args[args.indexOf(nombre) + 1];
if (!args.includes('--manifiesto') || !args.includes('--salida')) throw new Error('Uso: node ejecutar.mjs --manifiesto tiendas.json --perfil canary --salida resultado.json');
const perfil = args.includes('--perfil') ? opcion('--perfil') : 'canary';
const manifiesto = JSON.parse(fs.readFileSync(opcion('--manifiesto'), 'utf8'));
const etapas = validar(manifiesto, perfil);
const resultado = { inicio: new Date().toISOString(), perfil, entorno: manifiesto.entorno,
  incluyeEventos: !!manifiesto.eventos, estado: 'en_curso', etapas: [] };
let detener = false;
let secuencia = 0;
const runId = Date.now();
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on('SIGINT', () => { detener = true; });
process.on('SIGTERM', () => { detener = true; });

async function solicitud(tienda, ruta, etapa, cuerpo) {
  if (detener) return false;
  const inicio = performance.now();
  const headers = { 'User-Agent': 'Gesicomm-capacidad/1.0' };
  if (tienda.host) headers.Host = tienda.host;
  if (cuerpo) headers['Content-Type'] = 'application/json';
  let codigo = 0;
  let correcto = false;
  try {
    const res = await fetch(`${tienda.origen.replace(/\/$/, '')}${ruta}`, {
      method: cuerpo ? 'POST' : 'GET', headers,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    codigo = res.status;
    const datos = await res.json();
    correcto = cuerpo ? codigo === 202 && datos.ok === true : codigo === 200 && datos.disponible === true;
    if (!cuerpo && correcto && ruta.includes('vista=catalogo')) {
      correcto = Array.isArray(datos.catalogo_items) && datos.catalogo_items.length > 0
        && datos.catalogo_items.every(i => i.categoria === tienda.categoria);
    }
    if (!cuerpo && correcto && ruta.includes('/producto/')) correcto = datos.producto?.content_id === tienda.producto;
    if (!cuerpo) {
      const cache = res.headers.get('x-cache-status') || res.headers.get('cf-cache-status') || 'sin_header';
      etapa.cache[cache] = (etapa.cache[cache] || 0) + 1;
    }
  } catch { /* Se cuenta como fallo; no se imprime contenido de respuestas. */ }
  const ms = performance.now() - inicio;
  etapa.solicitudes += 1;
  // Histograma con resolución de 10 ms y tamaño constante, incluso con 15k usuarios.
  const cubeta = Math.min(1000, Math.floor(ms / 10));
  etapa.histograma[cubeta] = (etapa.histograma[cubeta] || 0) + 1;
  etapa.estados[codigo] = (etapa.estados[codigo] || 0) + 1;
  if (!correcto) etapa.fallos += 1;
  if (ms > 5000) etapa.lentas += 1;
  if (codigo === 429) { detener = true; resultado.motivo = 'rate_limit_429: no se pudo medir capacidad'; }
  else if (manifiesto.entorno === 'produccion' && !correcto) {
    detener = true; resultado.motivo = 'fallo_en_canary';
  }
  else if (etapa.solicitudes >= 20 && (etapa.fallos / etapa.solicitudes > 0.02 || etapa.lentas / etapa.solicitudes > 0.05)) {
    detener = true; resultado.motivo = 'umbral_de_error_o_latencia';
  }
  return correcto;
}

async function navegar(tienda, tipo, etapa) {
  const camino = rutas(tienda);
  const correcto = await solicitud(tienda, camino[tipo], etapa);
  if (!correcto || !manifiesto.eventos || detener) return;
  const evento = nombre => ({ event_name: nombre, event_id: `carga-${runId}-${++secuencia}`,
    event_source_url: tienda.origen,
    ...(nombre === 'ViewContent' ? { custom_data: { content_ids: [tienda.producto] } } : {}),
  });
  await solicitud(tienda, camino.eventos, etapa, evento('PageView'));
  if (tipo === 'inicio') await solicitud(tienda, camino.visita, etapa, {});
  if (tipo === 'producto') await solicitud(tienda, camino.eventos, etapa, evento('ViewContent'));
}

function resumir(etapa) {
  // El percentil se obtiene por el conteo de cubetas, sin expandir muestras.
  const objetivo = Math.ceil(etapa.solicitudes * 0.95);
  let acumulado = 0;
  let p95 = null;
  for (let i = 0; i <= 1000; i++) {
    acumulado += etapa.histograma[i] || 0;
    if (acumulado >= objetivo && etapa.solicitudes) { p95 = (i + 1) * 10; break; }
  }
  const { histograma, ...datos } = etapa;
  return { ...datos, solicitudesSegundo: Math.round(etapa.solicitudes / etapa.segundos * 100) / 100, p95Ms: p95 };
}

try {
  for (const configuracion of etapas) {
    if (detener) break;
    const etapa = { usuarios: configuracion.usuarios, solicitudes: 0, fallos: 0, lentas: 0, estados: {}, cache: {}, histograma: {} };
    const comienzo = performance.now();
    const fin = comienzo + configuracion.segundos * 1000;
    console.log(`Etapa: ${configuracion.usuarios} visitantes activos, ${configuracion.segundos || 'una vuelta por'} segundos`);
    await Promise.all(Array.from({ length: configuracion.usuarios }, async (_, indice) => {
      const tienda = manifiesto.tiendas[indice % manifiesto.tiendas.length];
      if (perfil === 'canary') {
        for (const tipo of ['inicio', 'categoria', 'producto']) {
          if (detener) break;
          await navegar(tienda, tipo, etapa);
          await esperar(1000);
        }
      } else {
        // Distribuir visitantes durante 30 s, sin una ráfaga artificial de 15k peticiones.
        await esperar(Math.random() * 30000);
        let vuelta = indice;
        while (!detener && performance.now() < fin) {
          const inicioPagina = performance.now();
          const n = (vuelta++ % 10);
          await navegar(tienda, n < 4 ? 'inicio' : n < 7 ? 'categoria' : 'producto', etapa);
          const espera = Math.max(0, 30000 - (performance.now() - inicioPagina));
          const hasta = performance.now() + espera;
          while (!detener && performance.now() < hasta) await esperar(Math.min(1000, hasta - performance.now()));
        }
      }
    }));
    etapa.segundos = (performance.now() - comienzo) / 1000;
    const resumen = resumir(etapa);
    resultado.etapas.push(resumen);
    console.log(JSON.stringify(resumen));
    fs.writeFileSync(opcion('--salida'), JSON.stringify(resultado, null, 2));
    if (perfil === 'canary' && !detener) await esperar(3000);
  }
  resultado.estado = detener ? 'detenido' : 'completado';
} finally {
  resultado.fin = new Date().toISOString();
  fs.writeFileSync(opcion('--salida'), JSON.stringify(resultado, null, 2));
}
if (detener || resultado.etapas.some(e => e.fallos > 0)) process.exitCode = 1;

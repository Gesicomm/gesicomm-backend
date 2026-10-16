export const perfiles = {
  canary: [{ usuarios: 1, segundos: 0 }, { usuarios: 3, segundos: 0 }, { usuarios: 5, segundos: 0 }],
  tienda300: [{ usuarios: 10, segundos: 30 }, { usuarios: 30, segundos: 60 }, { usuarios: 100, segundos: 120 }, { usuarios: 300, segundos: 300 }],
  tienda1000: [{ usuarios: 10, segundos: 30 }, { usuarios: 100, segundos: 60 }, { usuarios: 300, segundos: 120 }, { usuarios: 1000, segundos: 300 }],
  tiendas50: [{ usuarios: 50, segundos: 30 }, { usuarios: 500, segundos: 60 }, { usuarios: 1500, segundos: 120 }, { usuarios: 5000, segundos: 120 }, { usuarios: 15000, segundos: 300 }],
};

export function validar(manifiesto, perfil) {
  if (!perfiles[perfil]) throw new Error('Perfil desconocido');
  if (!['produccion', 'aislado'].includes(manifiesto.entorno)) throw new Error('Indicar entorno: produccion o aislado');
  if (!Array.isArray(manifiesto.tiendas) || !manifiesto.tiendas.length) throw new Error('Faltan tiendas');
  if (manifiesto.entorno === 'produccion' && perfil !== 'canary') throw new Error('En producción solo se permite canary: máximo 5 solicitudes simultáneas y 27 GET en total');
  if (manifiesto.entorno === 'produccion' && manifiesto.eventos) throw new Error('Canary de producción no genera eventos ni pedidos');
  if (perfil !== 'canary' && (!manifiesto.eventos || !manifiesto.metaCapiDesactivada)) throw new Error('La carga completa requiere eventos activos y Meta CAPI desactivada en tiendas de ensayo aisladas');
  const claves = new Set();
  for (const tienda of manifiesto.tiendas) {
    const url = new URL(tienda.origen);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Origen inválido');
    const clave = `${url.origin}|${tienda.host || url.host}|${tienda.slug || ''}`;
    if (claves.has(clave)) throw new Error('Cada tienda debe tener una identidad distinta');
    claves.add(clave);
    if (!tienda.producto || !tienda.categoria) throw new Error('Cada tienda necesita producto y categoría reales');
  }
  if (perfil === 'tiendas50' && claves.size !== 50) throw new Error('El escenario de 50 tiendas necesita 50 tiendas distintas; repetir una URL no simula aislamiento ni diversidad de caché');
  if (['tienda300', 'tienda1000'].includes(perfil) && claves.size !== 1) throw new Error('Este perfil mide una sola tienda');
  return perfiles[perfil];
}

export function rutas(tienda) {
  const base = tienda.slug ? `/api/l/${encodeURIComponent(tienda.slug)}` : '/api/l';
  return {
    inicio: `${base}/`,
    categoria: `${base}/?${new URLSearchParams({ vista: 'catalogo', pagina: '1', porPagina: '25', orden: 'destacados', categoria: tienda.categoria, soloDatos: 'true' })}`,
    producto: `${base}/producto/${encodeURIComponent(tienda.producto)}`,
    eventos: `${base}/eventos`, visita: `${base}/visita`,
  };
}

export function estimar(tiendas, visitantes, segundosEntrePaginas = 30) {
  const paginasSegundo = tiendas * visitantes / segundosEntrePaginas;
  // Mezcla: 40% inicio, 30% categoría, 30% ficha. Cada página genera
  // PageView; inicio además visita; ficha además ViewContent.
  return { visitantes: tiendas * visitantes, paginasSegundo, lecturasSegundo: paginasSegundo,
    eventosSegundo: paginasSegundo * 1.7, apiSegundo: paginasSegundo * 2.7 };
}

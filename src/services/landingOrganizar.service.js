/**
 * Organizar productos de la landing desde Mi catálogo ("Productos en mi
 * landing"): marcar varios de una como oferta, armar colecciones o quitar
 * todo. Espejo de OrganizadorProductos.jsx (frontend, pestaña Categorías del
 * editor): escribe en los MISMOS lugares que guarda el editor, así lo que se
 * hace acá se ve allá y al revés.
 *
 *   oferta    → landing_items.precio_ancla, la insignia en
 *               content.venta.presentacion_productos["producto:ID"] y, si
 *               lleva contador, content.venta.urgencia (productos + fin_at).
 *               El contador es uno solo para toda la tienda.
 *   colección → landing_items.etiqueta (coma-separada), que el catálogo
 *               público ya filtra y el inicio muestra como pestañas.
 *
 * Funciones puras: reciben las filas y la venta y devuelven qué cambiar. La
 * parte que toca la base vive en PrecioUsuarioService.organizarEnLandingActiva.
 */

const ACCIONES = ['oferta', 'quitar_oferta', 'coleccion', 'quitar_coleccion', 'quitar_todo'];
// Mismos badges que BADGES_OFERTA del frontend: "quitar oferta" solo borra
// estos; uno propio ("Nuevo") queda.
const BADGES_OFERTA = ['Oferta', 'Oferta del día', 'Solo por hoy', 'Liquidación', 'Hot sale'];
const MAX_PRODUCTOS_CONTADOR = 12; // limpiarUrgencia (landingCodigo.service)
const MAX_ETIQUETA = 50; // landing_items.etiqueta es STRING(50)

const normalizar = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const etiquetasDe = valor => String(valor || '').split(',').map(t => t.trim()).filter(Boolean);
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function conEtiqueta(actual, nombre) {
  const lista = etiquetasDe(actual);
  if (lista.some(t => normalizar(t) === normalizar(nombre))) return lista.join(', ');
  return [...lista, nombre].join(', ');
}
function sinEtiqueta(actual, nombre) {
  return etiquetasDe(actual).filter(t => normalizar(t) !== normalizar(nombre)).join(', ');
}

function error(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

/** Valida y normaliza el payload de la acción. */
function normalizarPedido(payload = {}) {
  const accion = payload.accion;
  if (!ACCIONES.includes(accion)) throw error('Acción no válida.');
  const pedido = { accion };
  if (accion === 'oferta') {
    if (payload.pct != null && payload.pct !== '') {
      const pct = Number(payload.pct);
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 95) throw error('El descuento tiene que estar entre 1% y 94%.');
      pedido.pct = pct;
    }
    pedido.badge = texto(payload.badge, 40);
    if (payload.fin_at) {
      const fin = new Date(payload.fin_at);
      if (Number.isNaN(fin.getTime()) || fin.getTime() <= Date.now()) throw error('La fecha de fin tiene que ser futura.');
      pedido.fin_at = fin.toISOString();
    }
    pedido.titulo = texto(payload.titulo, 80);
  }
  if (accion === 'coleccion' || accion === 'quitar_coleccion') {
    const nombre = texto(String(payload.coleccion || '').replace(/,/g, ' '), 40);
    if (!nombre) throw error('Elegí o escribí el nombre de la colección.');
    pedido.coleccion = nombre;
  }
  return pedido;
}

/**
 * Calcula los cambios. `filas`: [{ tipo, referencia_id, etiqueta, precio_ancla,
 * precio, precio_tachado, content_id }] — solo las que están en la landing.
 * Devuelve { items: [{ tipo, referencia_id, etiqueta, precio_ancla }], venta, sin_lugar, contador_lleno }.
 */
function organizar(filas, ventaActual, pedido) {
  const venta = { ...(ventaActual || {}) };
  const presentacion = { ...(venta.presentacion_productos || {}) };
  const urgencia = { ...(venta.urgencia || {}) };
  let enContador = Array.isArray(urgencia.productos) ? [...urgencia.productos] : [];
  const items = [];
  const sinLugar = [];
  let contadorLleno = 0;
  let tocoPresentacion = false;

  const precioSinDescuento = f => (Number(f.precio_tachado) > Number(f.precio) && Number(f.precio) > 0 ? Math.round(Number(f.precio)) : null);
  const cambiarInsignia = (clave, valor, soloSiEsDeOferta) => {
    const actual = presentacion[clave] || {};
    if (soloSiEsDeOferta && !BADGES_OFERTA.includes(actual.insignia_principal)) return;
    // v: 2 = vacío significa "lo borré" (ver limpiarPresentacionProducto).
    // Solo se marca en una entrada nueva: en una vieja (sin v) cambiaría el
    // sentido de sus otros textos vacíos.
    const nueva = !Object.keys(actual).length;
    presentacion[clave] = nueva ? { v: 2, insignia_principal: valor } : { ...actual, insignia_principal: valor };
    tocoPresentacion = true;
  };

  for (const f of filas) {
    const clave = `${f.tipo}:${f.referencia_id}`;
    const cambio = { tipo: f.tipo, referencia_id: f.referencia_id, etiqueta: f.etiqueta ?? null, precio_ancla: f.precio_ancla ?? null };
    switch (pedido.accion) {
      case 'oferta':
        if (pedido.pct && Number(f.precio) > 0) cambio.precio_ancla = Math.ceil(Number(f.precio) / (1 - pedido.pct / 100));
        if (pedido.badge !== undefined) cambiarInsignia(clave, pedido.badge, false);
        if (pedido.fin_at && f.content_id && !enContador.includes(f.content_id)) {
          if (enContador.length < MAX_PRODUCTOS_CONTADOR) enContador.push(f.content_id);
          else contadorLleno += 1;
        }
        break;
      case 'quitar_oferta':
        cambio.precio_ancla = precioSinDescuento(f);
        cambio.etiqueta = sinEtiqueta(cambio.etiqueta, 'Oferta') || null;
        cambiarInsignia(clave, '', true);
        enContador = enContador.filter(id => id !== f.content_id);
        break;
      case 'quitar_todo':
        cambio.precio_ancla = precioSinDescuento(f);
        cambio.etiqueta = null;
        if (presentacion[clave]?.insignia_principal) cambiarInsignia(clave, '', false);
        enContador = enContador.filter(id => id !== f.content_id);
        break;
      case 'coleccion': {
        const siguiente = conEtiqueta(cambio.etiqueta, pedido.coleccion);
        if (siguiente.length > MAX_ETIQUETA) sinLugar.push(clave);
        else cambio.etiqueta = siguiente;
        break;
      }
      case 'quitar_coleccion':
        cambio.etiqueta = sinEtiqueta(cambio.etiqueta, pedido.coleccion) || null;
        break;
      default:
        break;
    }
    items.push(cambio);
  }

  if (tocoPresentacion) venta.presentacion_productos = presentacion;
  const contadorCambio = enContador.length !== (urgencia.productos || []).length
    || enContador.some((id, i) => id !== (urgencia.productos || [])[i]);
  if (pedido.accion === 'oferta' && pedido.fin_at) {
    venta.urgencia = {
      ...urgencia,
      activo: true,
      fin_at: pedido.fin_at,
      // Lo eligió el comercio recién, con fecha concreta: es real.
      estado: 'confirmado',
      productos: enContador,
      producto_id: null,
      ...(pedido.titulo ? { titulo: pedido.titulo } : {}),
    };
  } else if (contadorCambio) {
    venta.urgencia = { ...urgencia, productos: enContador };
  }
  return { items, venta, sin_lugar: sinLugar, contador_lleno: contadorLleno };
}

module.exports = { ACCIONES, BADGES_OFERTA, MAX_PRODUCTOS_CONTADOR, MAX_ETIQUETA, normalizarPedido, organizar, etiquetasDe };

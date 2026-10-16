'use strict';

const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');

test.each([
  [{ nombre_cliente: 'María', apellido_cliente: 'González' }, 'María'],
  [{ nombre_cliente: 'María José', apellido_cliente: 'González' }, 'María'],
  [{ nombre_cliente: '  Juan\tCarlos  ', apellido_cliente: 'Pérez' }, 'Juan'],
  [{ cliente: 'María González' }, 'María'],
  [{ nombre_cliente: '  ', cliente: '  Ana\nLópez  ' }, 'Ana'],
  [{ nombre_cliente: 'Pedro', cliente: 'Ana López' }, 'Pedro'],
  [{ apellido_cliente: 'González' }, 'Cliente'],
  [{}, 'Cliente'],
])('WhatsApp usa solamente el primer nombre: %j', (pedido, nombre) => {
  expect(resolverMensaje('Hola {cliente_nombre} / {{cliente_nombre}} / {nombre}', pedido))
    .toBe(`Hola ${nombre} / ${nombre} / ${nombre}`);
});

test('la vista previa del nombre coincide con el mensaje real y conserva los datos del pedido', () => {
  const pedido = { nombre_cliente: 'María José', apellido_cliente: 'González' };
  const variable = listarVariablesDisponibles().find(v => v.key === 'cliente_nombre');
  expect(variable).toMatchObject({ desc: 'Primer nombre del cliente', ejemplo: 'María' });
  expect(resolverMensaje('Te cuento algo, {cliente_nombre}', pedido)).toBe(`Te cuento algo, ${variable.ejemplo}`);
  expect(pedido).toEqual({ nombre_cliente: 'María José', apellido_cliente: 'González' });
});


test('trae descripción y beneficios reales de los productos elegidos, sin HTML', () => {
  const envio = { items: [{ producto_id: 10, Producto: { id: 10, nombre: 'Silla', descripcion_corta: '<p>Silla para jardín &amp; terraza</p>', beneficios: [{ titulo: 'Plegable', texto: 'Se guarda con facilidad.' }] } }] };
  expect(resolverMensaje('{producto_descripcion}\n{producto_beneficios}', envio)).toBe('Silla para jardín & terraza\n• Plegable: Se guarda con facilidad.');
});

test('no inventa beneficios ni descripciones cuando faltan en el catálogo', () => {
  expect(resolverMensaje('{producto_descripcion}/{producto_beneficios}', { items: [{ producto_id: 10, Producto: { id: 10, nombre: 'Silla' } }] })).toBe('/');
});

test('todas las variables ofrecidas por el editor se resuelven y tienen claves únicas', () => {
  const variables = listarVariablesDisponibles();
  expect(new Set(variables.map(v => v.key)).size).toBe(variables.length);
  for (const variable of variables) {
    expect(resolverMensaje(`{${variable.key}}`, {})).not.toContain(`{${variable.key}}`);
    expect(resolverMensaje(`{{${variable.key}}}`, {})).not.toContain(`{${variable.key}}`);
  }
});

test('el resumen y las variables de entrega y pago usan los datos del pedido confirmado', () => {
  const pedido = {
    numero_pedido: 1044, monto: 120000, direccion: 'Calle 1', ciudad: 'Luque', departamento: 'Central',
    link_maps: 'https://maps.google.com/?q=Luque', pago_anticipado: true, metodo_pago: 'Transferencia',
    costo_envio: 20000, items: [{ nombre_producto: 'Silla', cantidad: 2, precio_unitario: 50000 }],
  };
  const resumen = resolverMensaje('{pedido_resumen}', pedido);
  expect(resumen).toContain('• Silla x2 — Gs. 100.000');
  expect(resumen).toContain('Total: Gs. 120.000');
  expect(resumen).toContain('Entrega: Calle 1, Luque, Central');
  expect(resumen).toContain('Ubicación: https://maps.google.com/?q=Luque');
  expect(resumen).toContain('Pago: Pago anticipado · Transferencia');
  expect(resolverMensaje('{pago_modalidad}/{metodo_pago}/{envio_cobrado}', pedido)).toBe('Pago anticipado/Transferencia/Gs. 20.000');
  expect(resolverMensaje('{envio_cobrado}', { ...pedido, delivery_a_cargo: 'negocio' })).toBe('Gs. 0');
});

test('un lead mantiene el resumen como interés y no anuncia una modalidad de pago confirmada', () => {
  const lead = { id: 1067, es_lead: true, items: [] };
  expect(resolverMensaje('{pedido_id}', lead)).toBe('LEAD-1067');
  expect(resolverMensaje('{pago_modalidad}', lead)).toBe('Por definir');
  expect(resolverMensaje('{pedido_resumen}', lead)).toContain('Productos de interés');
  expect(resolverMensaje('{pedido_resumen}', lead)).not.toContain('Pago:');
});

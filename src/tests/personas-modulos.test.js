const { regla } = require('../middleware/accesoColaborador');
const { permisosLegacy } = require('../middleware/modulosColaborador');
const modulos = require('../services/modulosAcceso.json');
const reglas = require('../middleware/rutasColaborador.json');
const puede = (permisos, method, originalUrl) => regla({ usuario: { tiendaId: 7, accesos: permisos }, method, originalUrl, body: {} });
const casos = [
 ['negocio','GET','/api/mi-tienda/fulfillment','PUT','/api/mi-tienda'],
 ['depositos','POST','/api/depositos/listado','POST','/api/depositos'],
 ['productos','POST','/api/vitrina/catalogo-paginado','PUT','/api/productos/3'],
 ['ecommerce','GET','/api/mis-landings-simples/4','PUT','/api/mis-landings-simples/4'],
 ['publicidad','POST','/api/meta-reportes/resumen','POST','/api/meta-reportes/campanas'],
 ['comercial','POST','/api/envios/list','POST','/api/envios'],
 ['logistica','POST','/api/envios/resumen-entregados','POST','/api/liquidaciones/confirmar'],
 ['finanzas','POST','/api/costos-gastos/reporte-desglose','POST','/api/costos-gastos'],
 ['afiliados','GET','/api/afiliados/me','POST','/api/afiliados/me'],
 ['partner','GET','/api/partner/me','POST','/api/partner/me'],
 ['academia','GET','/api/educacion/modulos','POST','/api/educacion/lecciones/1/completar'],
 ['configuracion','GET','/api/meta/stores','GET','/api/meta/connect'],
];
test.each(casos)('%s distingue sin acceso, lectura y gestión', (mod, rm, rp, wm, wp) => {
 expect(puede({},rm,rp)).toBe(false);
 expect(puede({[mod]:'ver'},rm,rp)).toBe(true);
 expect(puede({[mod]:'ver'},wm,wp)).toBe(false);
 expect(puede({[mod]:'gestionar'},wm,wp)).toBe(true);
});
test('dashboards y clientes son consulta; importación requiere gestionar para solicitar',()=>{
 expect(puede({dashboard_general:'ver'},'POST','/api/mis-landings/todas/estadisticas-rango')).toBe(true);
 expect(puede({dashboard_operativo:'ver'},'POST','/api/reportes/kpis')).toBe(true);
 expect(puede({clientes:'ver'},'POST','/api/clientes/pedidos')).toBe(true);
 expect(puede({clientes:'ver'},'POST','/api/envios')).toBe(false);
 expect(puede({importacion:'ver'},'POST','/api/importada-china/solicitudes')).toBe(false);
 expect(puede({importacion:'gestionar'},'POST','/api/importada-china/solicitudes')).toBe(true);
});
test('ninguna combinación de módulos concede administración de plataforma, usuarios o credenciales API',()=>{
 const p=Object.fromEntries(modulos.map(m=>[m.clave,m.gestionable?'gestionar':'ver']));
 for(const [method,path] of [['POST','/api/personas'],['GET','/api/auth/service-token'],['PUT','/api/config/parametros'],['GET','/api/raha-portal'],['POST','/api/inventario/ingresos/2/recepcion'],['GET','/api/afiliados'],['POST','/api/integraciones/productos/credenciales'],['GET','/api/endpoint-nuevo']]) expect(puede(p,method,path)).toBe(false);
});
test('lecturas auxiliares no otorgan escritura de productos ni de pedidos',()=>{
 for (const mod of ['ecommerce','publicidad','depositos']) {
  expect(puede({[mod]:'gestionar'},'POST','/api/productos/buscar')).toBe(true);
  expect(puede({[mod]:'gestionar'},'DELETE','/api/productos/3')).toBe(false);
  expect(puede({[mod]:'gestionar'},'POST','/api/envios')).toBe(false);
 }
 expect(permisosLegacy({productos:'ver'})).not.toContain('editar_productos');
 expect(permisosLegacy({productos:'gestionar'})).toContain('editar_productos');
});
test('el catálogo es completo y las reglas solo referencian módulos existentes',()=>{
 expect(modulos).toHaveLength(16);
 for(const r of reglas) for(const m of r.modulos) expect(modulos.some(x=>x.clave===m)).toBe(true);
});
test('las rutas nuevas y prefijos parecidos no heredan privilegios',()=>{
 expect(puede({productos:'gestionar'},'POST','/api/productos/admin/nuevo')).toBe(false);
 expect(puede({ecommerce:'gestionar'},'GET','/api/mis-landings-simples-extra/1')).toBe(false);
 expect(puede({configuracion:'ver'},'POST','/api/meta/pendiente/confirmar')).toBe(false);
});

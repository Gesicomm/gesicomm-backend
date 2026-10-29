'use strict';
const PLANES = [
  ['una-ruta-mensual','Una ruta mensual','elegir','mensual',297000],
  ['una-ruta-anual','Una ruta anual','elegir','anual',2970000],
  ['ambas-rutas-mensual','Ambas rutas mensual','ambas','mensual',397000],
  ['ambas-rutas-anual','Ambas rutas anual','ambas','anual',3970000],
].map(([codigo,nombre,acceso_rutas,periodicidad,precio],index)=>({
  codigo,nombre,acceso_rutas,periodicidad,precio,moneda:'PYG',equivale_plan:'pago',
  resumen:acceso_rutas==='elegir'?'Elegí Gestión de E-commerce o Marca personal.':'Gestión de E-commerce y Marca personal en una misma cuenta.',
  features:[acceso_rutas==='elegir'?'Una ruta a elección':'Las dos rutas incluidas','Tutoriales por sección','Soporte técnico por WhatsApp en horario laboral'],
  etiqueta:null,cta:'Contratar plan',destacado:codigo==='ambas-rutas-mensual',orden:index+1,activo:true,
}));
const CODIGOS = PLANES.map(plan=>plan.codigo);
const planCanonico = codigo => PLANES.find(plan=>plan.codigo===codigo);
module.exports={PLANES,CODIGOS,planCanonico};

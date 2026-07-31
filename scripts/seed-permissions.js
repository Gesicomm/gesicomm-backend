require('dotenv').config();
const { sequelize, Rol, Permiso } = require('../src/models');

const permisosDisponibles = [
  { nombre: 'ver_dashboard', descripcion: 'Acceso básico al panel principal' },
  { nombre: 'gestionar_usuarios', descripcion: 'Puede invitar, editar y eliminar usuarios' },
  { nombre: 'configurar_sistema', descripcion: 'Acceso a ajustes técnicos globales' },
  // Combos
  { nombre: 'ver_combos', descripcion: 'Ver y listar combos' },
  { nombre: 'crear_combos', descripcion: 'Crear nuevos combos' },
  { nombre: 'editar_combos', descripcion: 'Modificar combos existentes' },
  { nombre: 'activar_combos', descripcion: 'Activar y desactivar combos' },
  { nombre: 'configurar_combos', descripcion: 'Configurar parámetros económicos de combos' },
  // Productos
  { nombre: 'ver_productos', descripcion: 'Ver y buscar el catálogo de productos' },
  { nombre: 'crear_productos', descripcion: 'Crear nuevos productos' },
  { nombre: 'editar_productos', descripcion: 'Modificar productos existentes y subir imágenes' },
  { nombre: 'eliminar_productos', descripcion: 'Eliminar productos y sus imágenes' },
  // Vitrina de usuario (landing propia)
  { nombre: 'ver_analisis_sensibilidad', descripcion: 'Ver el análisis de sensibilidad de precios de productos y combos' },
  { nombre: 'gestionar_precio_propio', descripcion: 'Definir el precio de venta propio de productos y combos, respetando el precio mínimo' },
  { nombre: 'gestionar_landing', descripcion: 'Crear, editar, publicar y despublicar landings públicas propias' },
  { nombre: 'gestionar_tienda', descripcion: 'Configurar la tienda propia: subdominio, dominio propio, colores, contacto y pixel' },
];

const rolesBasicos = [
  {
    nombre: 'administrador',
    permisos: [
      'ver_dashboard', 'gestionar_usuarios', 'configurar_sistema',
      'ver_combos', 'crear_combos', 'editar_combos', 'activar_combos', 'configurar_combos',
      'ver_productos', 'crear_productos', 'editar_productos', 'eliminar_productos',
      'ver_analisis_sensibilidad',
    ],
  },
  {
    nombre: 'usuario',
    permisos: ['ver_dashboard', 'ver_productos', 'ver_combos', 'ver_analisis_sensibilidad', 'gestionar_precio_propio', 'gestionar_landing', 'gestionar_tienda'],
  },
];

async function seed() {
  try {
    console.log('Iniciando carga de permisos y roles...');
    await sequelize.authenticate();
    
    // 1. Crear permisos
    for (const p of permisosDisponibles) {
      await Permiso.findOrCreate({
        where: { nombre: p.nombre },
        defaults: { descripcion: p.descripcion },
      });
    }
    console.log(`✅ ${permisosDisponibles.length} permisos verificados/creados.`);

    // 2. Crear roles y asociar permisos
    for (const r of rolesBasicos) {
      const [rol] = await Rol.findOrCreate({
        where: { nombre: r.nombre },
      });
      
      const permisos = await Permiso.findAll({
        where: { nombre: r.permisos }
      });

      await rol.setPermisos(permisos);
    }
    console.log(`✅ Roles básicos ('administrador', 'usuario') inicializados y vinculados a sus permisos.`);
    
    console.log('🎉 Seed completado exitosamente.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error durante el seed:', error);
    process.exit(1);
  }
}

seed();

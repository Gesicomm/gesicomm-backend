require('dotenv').config();
const { sequelize, Rol, Permiso } = require('../src/models');

const permisosDisponibles = [
  { nombre: 'ver_dashboard', descripcion: 'Acceso básico al panel principal' },
  { nombre: 'gestionar_usuarios', descripcion: 'Puede invitar, editar y eliminar usuarios' },
  { nombre: 'configurar_sistema', descripcion: 'Acceso a ajustes técnicos globales' },
];

const rolesBasicos = [
  {
    nombre: 'administrador',
    permisos: ['ver_dashboard', 'gestionar_usuarios', 'configurar_sistema'],
  },
  {
    nombre: 'usuario',
    permisos: ['ver_dashboard'],
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

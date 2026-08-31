const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Proyecto del Page Builder: el contenedor de trabajo del comercio.
 * Agrupa páginas sueltas y funnels de un mismo negocio.
 *
 *   Proyecto "Mi Negocio"
 *     ├── BuilderPage  "About"    (suelta)   → /p/about
 *     ├── BuilderPage  "Contacto" (suelta)   → /p/contacto
 *     └── BuilderFunnel "Creatina"           → /f/creatina/...
 *
 * NO tiene `slug` ni columna `tipo` a propósito:
 *  - un proyecto no se publica y no aparece en ninguna URL pública;
 *  - lo que decide si algo es una página o un funnel es de qué tabla es
 *    fila, no una columna discriminadora.
 *
 * ⚠️ NO TIENE tienda_id, y es a propósito. A diferencia de las landings,
 * una página del Page Builder no pertenece a ninguna tienda: es una
 * página suelta, sin dependencias, que existe aunque su dueño no tenga
 * tienda ninguna (el caso de todos los administradores). El dueño es
 * `usuario_id`, y ese es el filtro de toda consulta.
 *
 * `inquilino_id` se conserva por convención del proyecto y para reportes
 * a nivel inquilino, pero NO es el control de acceso de este módulo.
 *
 * ⚠️ Tampoco confundir con Funnel.js / funnel.service.js, que son el
 * embudo de un solo producto sobre la tabla `landings`. Son cosas
 * distintas; este módulo entero vive bajo el prefijo `builder_`.
 */
const BuilderProject = sequelize.define('BuilderProject', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Tenencia y reportes. NO es el control de acceso de este módulo: ese es usuario_id.',
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'El DUEÑO. Filtro de toda consulta del módulo. Si se borra el usuario, se van sus proyectos (ON DELETE CASCADE).',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(15),
    allowNull: false,
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'published', 'unpublished']] },
    comment: 'Derivado de sus páginas y funnels, pero se persiste para poder filtrar el listado sin subconsulta. Lo recalcula builderProject.service.js.',
  },
}, {
  tableName: 'builder_projects',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['usuario_id'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = BuilderProject;

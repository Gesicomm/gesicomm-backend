const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registro de HOSTNAMES del Page Builder: la única tabla que contesta
 * "quién sirve este host".
 *
 * Cada página suelta o funnel se publica en su propia dirección:
 *
 *   calcula.gesicomm.com   → tipo 'subdominio',     subdominio 'calcula'
 *   t2e.gesicomm.com       → tipo 'subdominio',     subdominio 't2e'
 *   t2e.com.py             → tipo 'dominio_propio', subdominio null
 *
 * Los dos casos viven en la misma tabla porque para el resolvedor público
 * son lo mismo. Lo único que cambia es cómo se consigue el certificado:
 * un subdominio de la plataforma no necesita nada (ya hay DNS y
 * certificado wildcard para *.gesicomm.com) y queda activo al crearse; un
 * dominio propio pasa por Cloudflare for SaaS, con TXT de verificación y
 * espera del certificado — el mismo mecanismo que Tienda.dominio_propio.
 *
 * Un target puede tener varios hostnames a la vez (el subdominio de la
 * plataforma y el dominio propio apuntando a la misma página).
 * `es_principal` marca cuál es la URL canónica: la que va en og:url y en
 * los links que genera el sistema.
 *
 * ⚠️ El namespace de subdominios es COMPARTIDO CON LAS TIENDAS: no puede
 * existir calcula.gesicomm.com si ya hay una tienda con subdominio
 * "calcula". Postgres no puede imponer una UNIQUE entre dos tablas, así
 * que lo valida utils/validarSubdominio.js consultando las dos.
 */
const BuilderDomain = sequelize.define('BuilderDomain', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'El dueño del hostname. Filtro de toda consulta del módulo.',
  },
  // --- Target: exactamente uno de los dos (CHECK en la base) ---
  pagina_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Página suelta que sirve este hostname. Se publica en la raíz: https://<hostname>/',
  },
  funnel_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Funnel que sirve este hostname. La raíz lleva a la página de entrada y cada paso cuelga de su slug: https://<hostname>/<pagina-slug>',
  },
  // --- Identidad ---
  tipo: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'subdominio',
    validate: { isIn: [['subdominio', 'dominio_propio']] },
  },
  hostname: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'El host completo, en minúsculas. Único GLOBAL: un hostname no puede resolver a dos lugares.',
  },
  subdominio: {
    type: DataTypes.STRING(63),
    allowNull: true,
    comment: 'Solo cuando tipo=subdominio: la etiqueta sola ("calcula"), sin el dominio base. Existe aparte del hostname para poder compararla contra tiendas.subdominio, que comparte el namespace.',
  },
  es_principal: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'La URL canónica del target. Única por página y por funnel (índices parciales).',
  },
  // --- Solo para dominio_propio ---
  estado_verificacion: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pendiente',
    validate: { isIn: [['pendiente', 'verificando', 'verificado', 'error']] },
    comment: 'Un subdominio de la plataforma nace en "verificado": no hay nada que verificar.',
  },
  estado_ssl: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pendiente',
    validate: { isIn: [['pendiente', 'emitiendo', 'activo', 'error']] },
    comment: 'Un subdominio de la plataforma nace en "activo": lo cubre el certificado wildcard del origen.',
  },
  cf_hostname_id: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'ID del Custom Hostname de Cloudflare for SaaS. Mismo campo que Tienda.dominio_propio_cf_hostname_id.',
  },
  verificacion_txt_nombre: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'El registro TXT que se le muestra al usuario para que lo cargue en su DNS.',
  },
  verificacion_txt_valor: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  ultimo_chequeo_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'builder_domains',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // Los índices parciales (subdominio, es_principal por target) y los
  // CHECK del target viven solo en la migración.
  indexes: [
    { unique: true, fields: ['hostname'] },
    { fields: ['usuario_id'] },
    { fields: ['pagina_id'] },
    { fields: ['funnel_id'] },
  ],
});

module.exports = BuilderDomain;

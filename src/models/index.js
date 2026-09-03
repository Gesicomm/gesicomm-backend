const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Rol = require('./Rol');
const Permiso = require('./Permiso');
const RolPermiso = require('./RolPermiso');
const Usuario = require('./Usuario');
const MetaIntegration = require('./MetaIntegration');
const Categoria = require('./Categoria');
const Marca = require('./Marca');
const Producto = require('./Producto');
const ProductoVariante = require('./ProductoVariante');
const ProductoImagen = require('./ProductoImagen');
const ProductoFaq = require('./ProductoFaq');
const ProductoCombo = require('./ProductoCombo');
const ProductoComboItem = require('./ProductoComboItem');
const ProductoRelacionado = require('./ProductoRelacionado');
const HistorialPrecio = require('./HistorialPrecio');
const ComboConfiguracion = require('./ComboConfiguracion');
const Oferta = require('./Oferta');
const OfertaComponente = require('./OfertaComponente');
const Courier = require('./Courier');
const CourierTarifa = require('./CourierTarifa');
const Envio = require('./Envio');
const EnvioItem = require('./EnvioItem');
const EnvioItemComponente = require('./EnvioItemComponente');
const MetodoPago = require('./MetodoPago');
const Liquidacion = require('./Liquidacion');
const LiquidacionEnvio = require('./LiquidacionEnvio');
const EnvioHistorial = require('./EnvioHistorial');
const PrecioUsuario = require('./PrecioUsuario');
const Tienda = require('./Tienda');
const LandingTemplate = require('./LandingTemplate');
const Landing = require('./Landing');
const Funnel = require('./Funnel');
const TiendaPagina = require('./TiendaPagina');
const LandingItem = require('./LandingItem');
const LandingSeccion = require('./LandingSeccion');
const LandingEvento = require('./LandingEvento');
const Testimonio = require('./Testimonio');
const Faq = require('./Faq');
const LandingBeneficio = require('./LandingBeneficio');
const SolicitudEliminacion = require('./SolicitudEliminacion');
const MensajeContacto = require('./MensajeContacto');
const MetaCampanaInterna = require('./MetaCampanaInterna');
const MetaReporteImport = require('./MetaReporteImport');
const MetaReporteFila = require('./MetaReporteFila');
const Proveedor = require('./Proveedor');
const CategoriaCostoGasto = require('./CategoriaCostoGasto');
const CostoGasto = require('./CostoGasto');
const CanalVenta = require('./CanalVenta');
// Page Builder — módulo de páginas y funnels de código.
// ⚠️ BuilderFunnel NO es Funnel: ver la cabecera de BuilderFunnel.js.
const BuilderProject = require('./BuilderProject');
const BuilderFunnel = require('./BuilderFunnel');
const BuilderPage = require('./BuilderPage');
const BuilderPageVersion = require('./BuilderPageVersion');
const BuilderFunnelPage = require('./BuilderFunnelPage');
const BuilderDomain = require('./BuilderDomain');
const PaymentGateway = require('./PaymentGateway');
const PaymentTransaction = require('./PaymentTransaction');

// ============================================================
// Relaciones existentes
// ============================================================
Inquilino.hasMany(Usuario, { foreignKey: 'inquilino_id' });
Usuario.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Inquilino.hasOne(MetaIntegration, { foreignKey: 'inquilino_id' });
MetaIntegration.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

Rol.belongsToMany(Permiso, { through: RolPermiso, foreignKey: 'rol_id' });
Permiso.belongsToMany(Rol, { through: RolPermiso, foreignKey: 'permiso_id' });

// ============================================================
// Relaciones de Logística (Courier y Envíos)
// ============================================================
Usuario.hasMany(Courier, { foreignKey: 'usuario_id' });
Courier.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Courier.hasMany(CourierTarifa, { as: 'tarifas', foreignKey: 'courier_id', onDelete: 'CASCADE' });
CourierTarifa.belongsTo(Courier, { foreignKey: 'courier_id' });

Usuario.hasMany(Envio, { foreignKey: 'usuario_id' });
Envio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Courier.hasMany(Envio, { foreignKey: 'courier_id' });
Envio.belongsTo(Courier, { foreignKey: 'courier_id' });

// SET NULL y no CASCADE: desactivar o borrar un canal no puede llevarse
// puestos los pedidos que entraron por él (su `origen` histórico sigue ahí).
CanalVenta.hasMany(Envio, { foreignKey: 'canal_venta_id', onDelete: 'SET NULL' });
Envio.belongsTo(CanalVenta, { as: 'canal_venta', foreignKey: 'canal_venta_id' });

Envio.hasMany(EnvioItem, { as: 'items', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioItem.belongsTo(Envio, { foreignKey: 'envio_id' });
EnvioItem.belongsTo(Producto, { foreignKey: 'producto_id' });
EnvioItem.belongsTo(Oferta, { foreignKey: 'oferta_id' });

EnvioItem.hasMany(EnvioItemComponente, { as: 'componentes_vendidos', foreignKey: 'envio_item_id', onDelete: 'CASCADE' });
EnvioItemComponente.belongsTo(EnvioItem, { foreignKey: 'envio_item_id' });
EnvioItemComponente.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

Usuario.hasMany(MetodoPago, { foreignKey: 'usuario_id' });
MetodoPago.belongsTo(Usuario, { foreignKey: 'usuario_id' });

MetodoPago.hasMany(Envio, { foreignKey: 'metodo_pago_id' });
Envio.belongsTo(MetodoPago, { foreignKey: 'metodo_pago_id' });

// Rendición de couriers (Liquidacion)
Courier.hasMany(Liquidacion, { as: 'liquidaciones', foreignKey: 'courier_id' });
Liquidacion.belongsTo(Courier, { foreignKey: 'courier_id' });
Usuario.hasMany(Liquidacion, { foreignKey: 'usuario_id' });
Liquidacion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Liquidacion.hasMany(LiquidacionEnvio, { as: 'envios_incluidos', foreignKey: 'liquidacion_id', onDelete: 'CASCADE' });
LiquidacionEnvio.belongsTo(Liquidacion, { foreignKey: 'liquidacion_id' });
LiquidacionEnvio.belongsTo(Envio, { foreignKey: 'envio_id' });
Envio.hasOne(LiquidacionEnvio, { foreignKey: 'envio_id' });

// Historial/trazabilidad simple del pedido (ver plan sección 24)
Envio.hasMany(EnvioHistorial, { as: 'historial', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioHistorial.belongsTo(Envio, { foreignKey: 'envio_id' });
Usuario.hasMany(EnvioHistorial, { foreignKey: 'usuario_id' });
EnvioHistorial.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// ============================================================
// Relaciones de Categoría
// ============================================================
Inquilino.hasMany(Categoria, { foreignKey: 'inquilino_id' });
Categoria.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// Auto-referencia para jerarquía (parent_id)
Categoria.hasMany(Categoria, { as: 'subcategorias', foreignKey: 'parent_id' });
Categoria.belongsTo(Categoria, { as: 'padre', foreignKey: 'parent_id' });

// ============================================================
// Relaciones de Marca
// ============================================================
Inquilino.hasMany(Marca, { foreignKey: 'inquilino_id' });
Marca.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// ============================================================
// Relaciones de Producto
// ============================================================
Inquilino.hasMany(Producto, { foreignKey: 'inquilino_id' });
Producto.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Categoria.hasMany(Producto, { foreignKey: 'categoria_id' });
Producto.belongsTo(Categoria, { as: 'categoria', foreignKey: 'categoria_id' });

Marca.hasMany(Producto, { foreignKey: 'marca_id' });
Producto.belongsTo(Marca, { foreignKey: 'marca_id' });

// Auditoría: quién creó/modificó
Usuario.hasMany(Producto, { as: 'ProductosCreados', foreignKey: 'creado_por' });
Producto.belongsTo(Usuario, { as: 'Creador', foreignKey: 'creado_por' });
Usuario.hasMany(Producto, { as: 'ProductosModificados', foreignKey: 'modificado_por' });
Producto.belongsTo(Usuario, { as: 'Modificador', foreignKey: 'modificado_por' });

// ============================================================
// Relaciones de tablas hijas de Producto
// ============================================================

// Variantes
Producto.hasMany(ProductoVariante, { as: 'variantes', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoVariante.belongsTo(Producto, { foreignKey: 'producto_id' });

// Imágenes (pueden asociarse a producto o a variante específica)
Producto.hasMany(ProductoImagen, { as: 'imagenes', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoImagen.belongsTo(Producto, { foreignKey: 'producto_id' });
ProductoVariante.hasMany(ProductoImagen, { as: 'imagenes', foreignKey: 'variante_id' });
ProductoImagen.belongsTo(ProductoVariante, { foreignKey: 'variante_id' });

// FAQ propia de cada producto ("Todo lo que necesitas saber")
Producto.hasMany(ProductoFaq, { as: 'faq', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoFaq.belongsTo(Producto, { foreignKey: 'producto_id' });

// Combos (Multi-producto)
Inquilino.hasMany(ProductoCombo, { foreignKey: 'inquilino_id' });
ProductoCombo.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Producto.hasMany(ProductoCombo, { as: 'combos', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoCombo.belongsTo(Producto, { as: 'producto_padre', foreignKey: 'producto_id' });

ProductoCombo.hasMany(ProductoComboItem, { as: 'items', foreignKey: 'combo_id', onDelete: 'CASCADE' });
ProductoComboItem.belongsTo(ProductoCombo, { foreignKey: 'combo_id' });

Producto.hasMany(ProductoComboItem, { as: 'como_item_de_combo', foreignKey: 'producto_incluido_id', onDelete: 'CASCADE' });
ProductoComboItem.belongsTo(Producto, { as: 'producto_incluido', foreignKey: 'producto_incluido_id' });

// Configuración económica de combos por tenant
Inquilino.hasOne(ComboConfiguracion, { foreignKey: 'inquilino_id' });
ComboConfiguracion.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// Ofertas comerciales (pack/combo × normal/order_bump/upsell)
Inquilino.hasMany(Oferta, { foreignKey: 'inquilino_id' });
Oferta.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Producto.hasMany(Oferta, { as: 'ofertas', foreignKey: 'producto_ancla_id', onDelete: 'CASCADE' });
Oferta.belongsTo(Producto, { as: 'producto_ancla', foreignKey: 'producto_ancla_id' });

Oferta.hasMany(OfertaComponente, { as: 'componentes', foreignKey: 'oferta_id', onDelete: 'CASCADE' });
OfertaComponente.belongsTo(Oferta, { foreignKey: 'oferta_id' });

Producto.hasMany(OfertaComponente, { as: 'como_componente_de_oferta', foreignKey: 'producto_id' });
OfertaComponente.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

// Productos relacionados (relación muchos-a-muchos auto-referencial)
Producto.hasMany(ProductoRelacionado, { as: 'relaciones', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoBase', foreignKey: 'producto_id' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoVinculado', foreignKey: 'producto_relacionado_id' });

// Historial de precios
Producto.hasMany(HistorialPrecio, { as: 'historial_precios', foreignKey: 'producto_id' });
HistorialPrecio.belongsTo(Producto, { foreignKey: 'producto_id' });
Usuario.hasMany(HistorialPrecio, { foreignKey: 'usuario_id' });
HistorialPrecio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Precios propios por usuario (vitrina / landing)
Usuario.hasMany(PrecioUsuario, { as: 'precios_personalizados', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
PrecioUsuario.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Tienda: 1:1 con Usuario, dueña de las landings públicas
Usuario.hasOne(Tienda, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
Tienda.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Tienda.hasMany(Landing, { as: 'landings', foreignKey: 'tienda_id', onDelete: 'CASCADE' });
Landing.belongsTo(Tienda, { foreignKey: 'tienda_id' });

Landing.hasMany(LandingItem, { as: 'items', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingItem.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(LandingSeccion, { as: 'secciones', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingSeccion.belongsTo(Landing, { foreignKey: 'landing_id' });

LandingTemplate.hasMany(Landing, { as: 'landings', foreignKey: 'template_id' });
Landing.belongsTo(LandingTemplate, { as: 'template', foreignKey: 'template_id' });

// Un embudo (template.kind='funnel') vende UN producto — ver
// funnel.service.js. En el resto de las landings producto_id es null.
Landing.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

// Relación de productos con landings (page-builder)
Landing.hasMany(LandingEvento, { as: 'eventos', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingEvento.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(Testimonio, { as: 'testimonios', foreignKey: 'landing_id', onDelete: 'CASCADE' });
Testimonio.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(Faq, { as: 'faq', foreignKey: 'landing_id', onDelete: 'CASCADE' });
Faq.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(LandingBeneficio, { as: 'beneficios', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingBeneficio.belongsTo(Landing, { foreignKey: 'landing_id' });

// ============================================================
// Relaciones de Educación / Academia
// ============================================================
const ModuloEducacion = require('./ModuloEducacion');
const LeccionEducacion = require('./LeccionEducacion');
const Examen = require('./Examen');
const PreguntaExamen = require('./PreguntaExamen');
const ProgresoUsuarioModulo = require('./ProgresoUsuarioModulo');
const ProgresoUsuarioLeccion = require('./ProgresoUsuarioLeccion');

ModuloEducacion.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });
Inquilino.hasMany(ModuloEducacion, { as: 'modulosEducacion', foreignKey: 'inquilino_id' });

ModuloEducacion.hasMany(LeccionEducacion, { as: 'lecciones', foreignKey: 'modulo_id', onDelete: 'CASCADE' });
LeccionEducacion.belongsTo(ModuloEducacion, { foreignKey: 'modulo_id', as: 'modulo' });

ModuloEducacion.hasOne(Examen, { as: 'examen', foreignKey: 'modulo_id', onDelete: 'CASCADE' });
Examen.belongsTo(ModuloEducacion, { foreignKey: 'modulo_id' });

Examen.hasMany(PreguntaExamen, { as: 'preguntas', foreignKey: 'examen_id', onDelete: 'CASCADE' });
PreguntaExamen.belongsTo(Examen, { foreignKey: 'examen_id' });

Usuario.hasMany(ProgresoUsuarioModulo, { as: 'progresosEducacion', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
ProgresoUsuarioModulo.belongsTo(Usuario, { foreignKey: 'usuario_id' });

ModuloEducacion.hasMany(ProgresoUsuarioModulo, { as: 'progresos', foreignKey: 'modulo_id', onDelete: 'CASCADE' });
ProgresoUsuarioModulo.belongsTo(ModuloEducacion, { foreignKey: 'modulo_id' });

Usuario.hasMany(ProgresoUsuarioLeccion, { as: 'progresosLecciones', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
ProgresoUsuarioLeccion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

LeccionEducacion.hasMany(ProgresoUsuarioLeccion, { as: 'progresos', foreignKey: 'leccion_id', onDelete: 'CASCADE' });
ProgresoUsuarioLeccion.belongsTo(LeccionEducacion, { foreignKey: 'leccion_id', as: 'leccion' });

// ============================================================
// Cumplimiento (solicitudes de eliminación de datos)
// ============================================================
// SET NULL y no CASCADE a propósito: la solicitud de eliminación es la
// evidencia de que se cumplió con el derecho de supresión (GDPR art. 17,
// CCPA/CPRA), así que tiene que sobrevivir al borrado de la cuenta que la
// originó. Al borrarse el usuario queda la solicitud con estado/fechas y
// sin vínculo a la persona, que es exactamente lo que hay que conservar.
Usuario.hasMany(SolicitudEliminacion, { foreignKey: 'usuario_id', onDelete: 'SET NULL' });
SolicitudEliminacion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// ============================================================
// Meta Ads — campañas internas y reportes importados
// ============================================================
// SET NULL en las tres direcciones: borrar una integración de Meta, un
// funnel (Landing) o un import no debe llevarse puesta la campaña interna
// ni las filas de reporte ya guardadas — son el historial de métricas.
MetaIntegration.hasMany(MetaCampanaInterna, { foreignKey: 'meta_integration_id', onDelete: 'SET NULL' });
MetaCampanaInterna.belongsTo(MetaIntegration, { foreignKey: 'meta_integration_id' });

Landing.hasMany(MetaCampanaInterna, { foreignKey: 'landing_id', onDelete: 'SET NULL' });
MetaCampanaInterna.belongsTo(Landing, { foreignKey: 'landing_id', as: 'funnel' });

Usuario.hasMany(MetaCampanaInterna, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
MetaCampanaInterna.belongsTo(Usuario, { foreignKey: 'usuario_id' });

MetaReporteImport.hasMany(MetaReporteFila, { as: 'filas', foreignKey: 'meta_reporte_import_id', onDelete: 'CASCADE' });
MetaReporteFila.belongsTo(MetaReporteImport, { foreignKey: 'meta_reporte_import_id' });

MetaCampanaInterna.hasMany(MetaReporteFila, { as: 'filas_reporte', foreignKey: 'meta_campana_interna_id', onDelete: 'SET NULL' });
MetaReporteFila.belongsTo(MetaCampanaInterna, { foreignKey: 'meta_campana_interna_id', as: 'campana' });

// ============================================================
// Relaciones de Costos y Gastos (Finanzas)
// ============================================================
Usuario.hasMany(Proveedor, { foreignKey: 'usuario_id' });
Proveedor.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Inquilino.hasMany(CategoriaCostoGasto, { foreignKey: 'inquilino_id' });
CategoriaCostoGasto.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Usuario.hasMany(CostoGasto, { foreignKey: 'usuario_id' });
CostoGasto.belongsTo(Usuario, { foreignKey: 'usuario_id' });

CategoriaCostoGasto.hasMany(CostoGasto, { foreignKey: 'categoria_id' });
CostoGasto.belongsTo(CategoriaCostoGasto, { as: 'categoria', foreignKey: 'categoria_id' });

MetodoPago.hasMany(CostoGasto, { foreignKey: 'metodo_pago_id' });
CostoGasto.belongsTo(MetodoPago, { as: 'metodo_pago', foreignKey: 'metodo_pago_id' });

Proveedor.hasMany(CostoGasto, { foreignKey: 'proveedor_id' });
CostoGasto.belongsTo(Proveedor, { as: 'proveedor', foreignKey: 'proveedor_id' });

Proveedor.hasMany(Producto, { foreignKey: 'proveedor_id' });
Producto.belongsTo(Proveedor, { as: 'proveedor', foreignKey: 'proveedor_id' });

Producto.hasMany(CostoGasto, { foreignKey: 'producto_id' });
CostoGasto.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

ProductoVariante.hasMany(CostoGasto, { foreignKey: 'variante_id' });
CostoGasto.belongsTo(ProductoVariante, { as: 'variante', foreignKey: 'variante_id' });

Envio.hasMany(CostoGasto, { foreignKey: 'envio_id' });
CostoGasto.belongsTo(Envio, { as: 'envio', foreignKey: 'envio_id' });

// Auto-referencia: plantilla recurrente → ocurrencias generadas
CostoGasto.hasMany(CostoGasto, { as: 'ocurrencias', foreignKey: 'parent_recurring_id' });
CostoGasto.belongsTo(CostoGasto, { as: 'plantilla', foreignKey: 'parent_recurring_id' });

// ============================================================
// Page Builder
//
//   BuilderProject
//     ├── BuilderPage    (funnel_id NULL → suelta)
//     └── BuilderFunnel
//           ├── BuilderPage        (funnel_id = X)
//           └── BuilderFunnelPage  (orden + página de entrada)
//
//   BuilderPage ──< BuilderPageVersion   (versiones inmutables)
//
// ⚠️ BuilderFunnel no tiene nada que ver con Funnel (embudo de un producto
//    sobre la tabla `landings`). Ver la cabecera de BuilderFunnel.js.
//
// ⚠️ NADA de esto se asocia con Tienda, y es a propósito: una página del
//    Page Builder es independiente, no pertenece a ninguna tienda. El
//    dueño es Usuario.
// ============================================================
Usuario.hasMany(BuilderProject, { foreignKey: 'usuario_id' });
BuilderProject.belongsTo(Usuario, { as: 'dueño', foreignKey: 'usuario_id' });

BuilderProject.hasMany(BuilderFunnel, { as: 'funnels', foreignKey: 'proyecto_id' });
BuilderFunnel.belongsTo(BuilderProject, { as: 'proyecto', foreignKey: 'proyecto_id' });
BuilderFunnel.belongsTo(Usuario, { as: 'dueño', foreignKey: 'usuario_id' });

// Todas las páginas del proyecto, sueltas y de funnel. Para listar solo
// las sueltas hay que filtrar funnel_id IS NULL — lo hace el service, no
// un scope, para que quede a la vista en la consulta.
BuilderProject.hasMany(BuilderPage, { as: 'paginas', foreignKey: 'proyecto_id' });
BuilderPage.belongsTo(BuilderProject, { as: 'proyecto', foreignKey: 'proyecto_id' });

BuilderFunnel.hasMany(BuilderPage, { as: 'paginas', foreignKey: 'funnel_id' });
BuilderPage.belongsTo(BuilderFunnel, { as: 'funnel', foreignKey: 'funnel_id' });
BuilderPage.belongsTo(Usuario, { as: 'dueño', foreignKey: 'usuario_id' });

BuilderPage.hasMany(BuilderPageVersion, { as: 'versiones', foreignKey: 'pagina_id' });
BuilderPageVersion.belongsTo(BuilderPage, { as: 'pagina', foreignKey: 'pagina_id' });
BuilderPageVersion.belongsTo(Usuario, { as: 'autor', foreignKey: 'creado_por' });

// Los dos punteros que separan lo que se edita de lo que ve el visitante.
// Son FK circulares con la tabla de arriba: en la base se agregan con un
// ALTER posterior (ver la migración).
BuilderPage.belongsTo(BuilderPageVersion, { as: 'draft', foreignKey: 'draft_version_id' });
BuilderPage.belongsTo(BuilderPageVersion, { as: 'publicada', foreignKey: 'published_version_id' });

// El orden del funnel vive solo acá.
BuilderFunnel.hasMany(BuilderFunnelPage, { as: 'pasos', foreignKey: 'funnel_id' });
BuilderFunnelPage.belongsTo(BuilderFunnel, { as: 'funnel', foreignKey: 'funnel_id' });
// hasOne y no hasMany: UNIQUE (pagina_id) en la base limita una página a
// un solo funnel (ver BuilderFunnelPage.js).
BuilderPage.hasOne(BuilderFunnelPage, { as: 'paso', foreignKey: 'pagina_id' });
BuilderFunnelPage.belongsTo(BuilderPage, { as: 'pagina', foreignKey: 'pagina_id' });

// Registro de hostnames: cada página suelta o funnel se publica en su
// propia dirección (calcula.gesicomm.com, t2e.com.py). El target es una
// página O un funnel, nunca los dos (CHECK en la base).
Usuario.hasMany(BuilderDomain, { foreignKey: 'usuario_id' });
BuilderDomain.belongsTo(Usuario, { as: 'dueño', foreignKey: 'usuario_id' });
BuilderDomain.belongsTo(BuilderFunnel, { as: 'funnel', foreignKey: 'funnel_id' });
BuilderDomain.belongsTo(BuilderPage, { as: 'pagina', foreignKey: 'pagina_id' });
BuilderFunnel.hasMany(BuilderDomain, { as: 'hostnames', foreignKey: 'funnel_id' });
BuilderPage.hasMany(BuilderDomain, { as: 'hostnames', foreignKey: 'pagina_id' });

// ============================================================
// Relaciones de Pasarelas de Pago
// ============================================================
Usuario.hasMany(PaymentGateway, { as: 'payment_gateways', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
PaymentGateway.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });

Envio.hasOne(PaymentTransaction, { as: 'payment_transaction', foreignKey: 'envio_id', onDelete: 'CASCADE' });
PaymentTransaction.belongsTo(Envio, { as: 'envio', foreignKey: 'envio_id' });

module.exports = {
  sequelize,
  Inquilino,
  Rol,
  Permiso,
  RolPermiso,
  Usuario,
  MetaIntegration,
  Categoria,
  Marca,
  Producto,
  ProductoVariante,
  ProductoImagen,
  ProductoFaq,
  ProductoCombo,
  ProductoComboItem,
  ProductoRelacionado,
  HistorialPrecio,
  ComboConfiguracion,
  Oferta,
  OfertaComponente,
  Courier,
  CourierTarifa,
  Envio,
  EnvioItem,
  EnvioItemComponente,
  MetodoPago,
  Liquidacion,
  LiquidacionEnvio,
  EnvioHistorial,
  PrecioUsuario,
  Tienda,
  LandingTemplate,
  Landing,
  Funnel,
  TiendaPagina,
  LandingItem,
  LandingSeccion,
  LandingEvento,
  Testimonio,
  Faq,
  LandingBeneficio,
  ModuloEducacion,
  LeccionEducacion,
  Examen,
  PreguntaExamen,
  ProgresoUsuarioModulo,
  ProgresoUsuarioLeccion,
  SolicitudEliminacion,
  MensajeContacto,
  MetaCampanaInterna,
  MetaReporteImport,
  MetaReporteFila,
  Proveedor,
  CategoriaCostoGasto,
  CanalVenta,
  CostoGasto,
  BuilderProject,
  BuilderFunnel,
  BuilderPage,
  BuilderPageVersion,
  BuilderFunnelPage,
  BuilderDomain,
  PaymentGateway,
  PaymentTransaction,
};

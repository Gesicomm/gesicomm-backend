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
const ProductoOpcion = require('./ProductoOpcion');
const ProductoOpcionValor = require('./ProductoOpcionValor');
const ProductoVarianteValor = require('./ProductoVarianteValor');
const ProductoImagen = require('./ProductoImagen');
const ProductoFaq = require('./ProductoFaq');
const ProductoCombo = require('./ProductoCombo');
const ProductoComboItem = require('./ProductoComboItem');
const ProductoComboImagen = require('./ProductoComboImagen');
const ProductoRelacionado = require('./ProductoRelacionado');
const HistorialPrecio = require('./HistorialPrecio');
const ComboConfiguracion = require('./ComboConfiguracion');
const Oferta = require('./Oferta');
const OfertaComponente = require('./OfertaComponente');
const Courier = require('./Courier');
const CourierAcceso = require('./CourierAcceso');
const DeliveryZonaTarifa = require('./DeliveryZonaTarifa');
const Pais = require('./Pais');
const Departamento = require('./Departamento');
const Ciudad = require('./Ciudad');
const Deposito = require('./Deposito');
const DepositoCourier = require('./DepositoCourier');
const ProveedorLogistico = require('./ProveedorLogistico');
const CentroProveedorLogistico = require('./CentroProveedorLogistico');
const Envio = require('./Envio');
const EnvioItem = require('./EnvioItem');
const EnvioItemComponente = require('./EnvioItemComponente');
const EnvioIntentoEntrega = require('./EnvioIntentoEntrega');
const MetodoPago = require('./MetodoPago');
const Liquidacion = require('./Liquidacion');
const LiquidacionEnvio = require('./LiquidacionEnvio');
const EnvioHistorial = require('./EnvioHistorial');
const PrecioUsuario = require('./PrecioUsuario');
const Tienda = require('./Tienda');
const SpeedboxTienda = require('./SpeedboxTienda');
const SpeedboxPedido = require('./SpeedboxPedido');
const SpeedboxEvento = require('./SpeedboxEvento');
const RahaSolicitud = require('./RahaSolicitud');
const RahaDocumento = require('./RahaDocumento');
RahaSolicitud.belongsTo(Tienda, { as: 'tienda', foreignKey: 'tienda_id', onDelete: 'RESTRICT' });
RahaSolicitud.belongsTo(Usuario, { as: 'solicitante', foreignKey: 'usuario_id', onDelete: 'RESTRICT' });
RahaSolicitud.hasMany(RahaDocumento, { as: 'documentos', foreignKey: 'solicitud_id', onDelete: 'CASCADE' });
RahaDocumento.belongsTo(RahaSolicitud, { foreignKey: 'solicitud_id' });
const Page = require('./Page');
const PageVersion = require('./PageVersion');
const AiGenerationLog = require('./AiGenerationLog');
SpeedboxPedido.belongsTo(Envio, { as: 'envio', foreignKey: 'envio_id' });
const ProveedorDns = require('./ProveedorDns');
const LandingTemplate = require('./LandingTemplate');
const Landing = require('./Landing');
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
const Cupon = require('./Cupon');
const CuponProducto = require('./CuponProducto');
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
const Plan = require('./Plan');
const CheckoutIntent = require('./CheckoutIntent');
const SubscriptionPurchase = require('./SubscriptionPurchase');
const Suscripcion = require('./Suscripcion');
const PagoSuscripcion = require('./PagoSuscripcion');
const Parametro = require('./Parametro');
const Afiliado = require('./Afiliado');
const AfiliadoClick = require('./AfiliadoClick');
const AfiliadoComision = require('./AfiliadoComision');
const AuthEvent = require('./AuthEvent');
const UserSession = require('./UserSession');
const AuthNotification = require('./AuthNotification');
const NotificationEvent = require('./NotificationEvent');
const WhatsappPlantilla = require('./WhatsappPlantilla');
const WhatsappFlujo = require('./WhatsappFlujo');
const WhatsappFlujoFase = require('./WhatsappFlujoFase');
const SeguimientoEtiqueta = require('./SeguimientoEtiqueta');
const EnvioEtiqueta = require('./EnvioEtiqueta');
const SeguimientoContacto = require('./SeguimientoContacto');
const SeguimientoRecordatorio = require('./SeguimientoRecordatorio');
const Notificacion = require('./Notificacion');
const SeguimientoConfiguracion = require('./SeguimientoConfiguracion');
const InventarioUbicacion = require('./InventarioUbicacion');
const IngresoInventario = require('./IngresoInventario');
const IngresoInventarioItem = require('./IngresoInventarioItem');
const HistorialIngresoInventario = require('./HistorialIngresoInventario');
const SolicitudAbastecimiento = require('./SolicitudAbastecimiento');
const HistorialSolicitudAbastecimiento = require('./HistorialSolicitudAbastecimiento');
const GsqlModulo = require('./GsqlModulo');
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
Usuario.hasMany(CourierAcceso, { as: 'accesos_courier', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
CourierAcceso.belongsTo(Usuario, { foreignKey: 'usuario_id' });
Courier.hasOne(CourierAcceso, { as: 'acceso', foreignKey: 'courier_id', onDelete: 'CASCADE' });
CourierAcceso.belongsTo(Courier, { as: 'courier', foreignKey: 'courier_id' });

Usuario.hasMany(DeliveryZonaTarifa, { as: 'delivery_zonas', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
DeliveryZonaTarifa.belongsTo(Usuario, { foreignKey: 'usuario_id' });
Courier.hasMany(DeliveryZonaTarifa, { as: 'zonas_delivery', foreignKey: 'courier_id', onDelete: 'SET NULL' });
DeliveryZonaTarifa.belongsTo(Courier, { as: 'courier', foreignKey: 'courier_id' });

// Catálogo geográfico: país -> departamento -> ciudad.
Pais.hasMany(Departamento, { as: 'departamentos', foreignKey: 'pais_id', onDelete: 'CASCADE' });
Departamento.belongsTo(Pais, { as: 'pais', foreignKey: 'pais_id' });
Departamento.hasMany(Ciudad, { as: 'ciudades', foreignKey: 'departamento_id', onDelete: 'CASCADE' });
Ciudad.belongsTo(Departamento, { as: 'departamento', foreignKey: 'departamento_id' });

// Una tarifa apunta al catálogo según su tipo_cobertura (ver migración
// 20260920110000): ciudad concreta, resto de un departamento o resto del país.
Ciudad.hasMany(DeliveryZonaTarifa, { as: 'tarifas', foreignKey: 'ciudad_id', onDelete: 'SET NULL' });
DeliveryZonaTarifa.belongsTo(Ciudad, { as: 'ciudad_catalogo', foreignKey: 'ciudad_id' });
DeliveryZonaTarifa.belongsTo(Departamento, { as: 'departamento_catalogo', foreignKey: 'departamento_id' });
DeliveryZonaTarifa.belongsTo(Pais, { as: 'pais_catalogo', foreignKey: 'pais_id' });

// Depósitos propios del comercio (RF Gestión de Depósitos)
Usuario.hasMany(Deposito, { as: 'depositos', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
Deposito.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Desde qué depósito puede despachar cada courier (motor de fulfillment,
// Fase 2). La tarifa no vive en esta relación: pertenece al courier y su
// cobertura en delivery_zona_tarifas.
Deposito.belongsToMany(Courier, {
  as: 'couriers', through: DepositoCourier, foreignKey: 'deposito_id', otherKey: 'courier_id',
});
Courier.belongsToMany(Deposito, {
  as: 'depositos', through: DepositoCourier, foreignKey: 'courier_id', otherKey: 'deposito_id',
});
Deposito.hasMany(DepositoCourier, { as: 'vinculos_courier', foreignKey: 'deposito_id', onDelete: 'CASCADE' });
DepositoCourier.belongsTo(Deposito, { foreignKey: 'deposito_id' });
Courier.hasMany(DepositoCourier, { as: 'vinculos_deposito', foreignKey: 'courier_id', onDelete: 'CASCADE' });
DepositoCourier.belongsTo(Courier, { as: 'courier', foreignKey: 'courier_id' });

// ── Red logística de Gesicomm ────────────────────────────────────────────
// Deliberadamente en paralelo a lo de arriba y no reutilizándolo: el
// proveedor logístico no es un courier de nadie, y el centro es un depósito
// con alcance GESICOMM. Mezclar las dos relaciones fue exactamente lo que
// hizo que la red se configurara desde el panel de couriers del comercio.
Deposito.belongsToMany(ProveedorLogistico, {
  as: 'proveedores_logisticos', through: CentroProveedorLogistico,
  foreignKey: 'centro_id', otherKey: 'proveedor_logistico_id',
});
ProveedorLogistico.belongsToMany(Deposito, {
  as: 'centros', through: CentroProveedorLogistico,
  foreignKey: 'proveedor_logistico_id', otherKey: 'centro_id',
});
Deposito.hasMany(CentroProveedorLogistico, { as: 'vinculos_proveedor', foreignKey: 'centro_id', onDelete: 'CASCADE' });
CentroProveedorLogistico.belongsTo(Deposito, { as: 'centro', foreignKey: 'centro_id' });
ProveedorLogistico.hasMany(CentroProveedorLogistico, { as: 'vinculos_centro', foreignKey: 'proveedor_logistico_id', onDelete: 'CASCADE' });
CentroProveedorLogistico.belongsTo(ProveedorLogistico, { as: 'proveedor', foreignKey: 'proveedor_logistico_id' });

// Las tarifas de red cuelgan del proveedor Y del centro: el mismo proveedor
// puede cobrar distinto a la misma ciudad según desde dónde sale.
ProveedorLogistico.hasMany(DeliveryZonaTarifa, { as: 'zonas', foreignKey: 'proveedor_logistico_id', onDelete: 'CASCADE' });
DeliveryZonaTarifa.belongsTo(ProveedorLogistico, { as: 'proveedor', foreignKey: 'proveedor_logistico_id' });
DeliveryZonaTarifa.belongsTo(Deposito, { as: 'centro', foreignKey: 'centro_id' });

Usuario.hasMany(Envio, { foreignKey: 'usuario_id' });
Envio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Destino de abastecimiento cuando la logística es PROPIA. SET NULL porque
// el snapshot destino_* del Envio sobrevive aunque el depósito se elimine.
Deposito.hasMany(Envio, { as: 'abastecimientos_destino', foreignKey: 'deposito_destino_id', onDelete: 'SET NULL' });
Envio.belongsTo(Deposito, { as: 'deposito_destino', foreignKey: 'deposito_destino_id' });

Courier.hasMany(Envio, { foreignKey: 'courier_id' });
Envio.belongsTo(Courier, { foreignKey: 'courier_id' });
Envio.belongsTo(ProveedorLogistico, { as: 'proveedorLogistico', foreignKey: 'proveedor_logistico_id' });

// SET NULL y no CASCADE: desactivar o borrar un canal no puede llevarse
// puestos los pedidos que entraron por él (su `origen` histórico sigue ahí).
CanalVenta.hasMany(Envio, { foreignKey: 'canal_venta_id', onDelete: 'SET NULL' });
Envio.belongsTo(CanalVenta, { as: 'canal_venta', foreignKey: 'canal_venta_id' });

// Borrar un cupón se lleva su lista de productos alcanzados (no tiene
// sentido sin el cupón). Borrar un PRODUCTO también saca esa fila: el
// cupón sigue existiendo, simplemente ya no alcanza a ese producto.
Cupon.hasMany(CuponProducto, { as: 'productos', foreignKey: 'cupon_id', onDelete: 'CASCADE' });
CuponProducto.belongsTo(Cupon, { foreignKey: 'cupon_id' });
Producto.hasMany(CuponProducto, { foreignKey: 'producto_id', onDelete: 'CASCADE' });
CuponProducto.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

Envio.hasMany(EnvioItem, { as: 'items', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioItem.belongsTo(Envio, { foreignKey: 'envio_id' });
EnvioItem.belongsTo(Producto, { foreignKey: 'producto_id' });
EnvioItem.belongsTo(ProductoVariante, { as: 'Variante', foreignKey: 'variante_id' });
EnvioItem.belongsTo(Oferta, { foreignKey: 'oferta_id' });

EnvioItem.hasMany(EnvioItemComponente, { as: 'componentes_vendidos', foreignKey: 'envio_item_id', onDelete: 'CASCADE' });
EnvioItemComponente.belongsTo(EnvioItem, { foreignKey: 'envio_item_id' });
EnvioItemComponente.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });
EnvioItemComponente.belongsTo(Deposito, { as: 'centroOrigen', foreignKey: 'origen_centro_id' });

SolicitudAbastecimiento.belongsTo(Usuario, { foreignKey: 'usuario_id' });
SolicitudAbastecimiento.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });
SolicitudAbastecimiento.belongsTo(ProductoVariante, { as: 'variante', foreignKey: 'variante_id' });
SolicitudAbastecimiento.belongsTo(Deposito, { as: 'depositoDestino', foreignKey: 'deposito_destino_id' });
SolicitudAbastecimiento.belongsTo(Deposito, { as: 'centroGesicomm', foreignKey: 'centro_gesicomm_id' });
SolicitudAbastecimiento.hasMany(HistorialSolicitudAbastecimiento, { as: 'historial', foreignKey: 'solicitud_id', onDelete: 'CASCADE' });
HistorialSolicitudAbastecimiento.belongsTo(SolicitudAbastecimiento, { foreignKey: 'solicitud_id' });
HistorialSolicitudAbastecimiento.belongsTo(Usuario, { foreignKey: 'usuario_id' });

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

// Desglose de viajes del courier (ver EnvioIntentoEntrega). CASCADE porque
// es detalle del pedido; el courier se desengancha con SET NULL para que
// borrarlo no borre el registro de un viaje que se pagó.
Envio.hasMany(EnvioIntentoEntrega, { as: 'intentos_entrega', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioIntentoEntrega.belongsTo(Envio, { foreignKey: 'envio_id' });
Courier.hasMany(EnvioIntentoEntrega, { foreignKey: 'courier_id', onDelete: 'SET NULL' });
EnvioIntentoEntrega.belongsTo(Courier, { foreignKey: 'courier_id' });

// Historial/trazabilidad simple del pedido (ver plan sección 24)
Envio.hasMany(EnvioHistorial, { as: 'historial', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioHistorial.belongsTo(Envio, { foreignKey: 'envio_id' });
Usuario.hasMany(EnvioHistorial, { foreignKey: 'usuario_id' });
EnvioHistorial.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// ============================================================
// Seguimiento de pedidos por WhatsApp (RF Seguimiento WhatsApp)
// ============================================================
Usuario.hasMany(WhatsappPlantilla, { as: 'plantillas_whatsapp', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
WhatsappPlantilla.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Usuario.hasMany(SeguimientoEtiqueta, { as: 'etiquetas_seguimiento', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
SeguimientoEtiqueta.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Flujos de WhatsApp: el flujo es la unidad principal, la fase es el mensaje
// con su intencion dentro del flujo. CASCADE en las fases porque una fase no
// tiene sentido fuera de su flujo.
Usuario.hasMany(WhatsappFlujo, { as: 'flujos_whatsapp', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
WhatsappFlujo.belongsTo(Usuario, { foreignKey: 'usuario_id' });

WhatsappFlujo.hasMany(WhatsappFlujoFase, { as: 'fases', foreignKey: 'flujo_id', onDelete: 'CASCADE' });
WhatsappFlujoFase.belongsTo(WhatsappFlujo, { as: 'flujo', foreignKey: 'flujo_id' });

// La plantilla suelta de la que salio el flujo al migrar. SET NULL: borrar la
// plantilla vieja no se lleva el flujo que la reemplazo.
WhatsappPlantilla.hasOne(WhatsappFlujo, { as: 'flujo_migrado', foreignKey: 'plantilla_origen_id', onDelete: 'SET NULL' });
WhatsappFlujo.belongsTo(WhatsappPlantilla, { as: 'plantilla_origen', foreignKey: 'plantilla_origen_id' });

// Igual que con las plantillas: borrar una etiqueta deja la fase sin
// auto-etiquetado, no la tumba.
SeguimientoEtiqueta.hasMany(WhatsappFlujoFase, { foreignKey: 'etiqueta_id', onDelete: 'SET NULL' });
WhatsappFlujoFase.belongsTo(SeguimientoEtiqueta, { as: 'etiqueta', foreignKey: 'etiqueta_id' });

// SET NULL: borrar una etiqueta no puede tumbar la plantilla que la usaba,
// simplemente queda sin auto-etiquetado.
SeguimientoEtiqueta.hasMany(WhatsappPlantilla, { foreignKey: 'etiqueta_id', onDelete: 'SET NULL' });
WhatsappPlantilla.belongsTo(SeguimientoEtiqueta, { as: 'etiqueta', foreignKey: 'etiqueta_id' });

Envio.hasMany(EnvioEtiqueta, { as: 'etiquetas', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioEtiqueta.belongsTo(Envio, { foreignKey: 'envio_id' });
SeguimientoEtiqueta.hasMany(EnvioEtiqueta, { foreignKey: 'etiqueta_id', onDelete: 'CASCADE' });
EnvioEtiqueta.belongsTo(SeguimientoEtiqueta, { as: 'etiqueta', foreignKey: 'etiqueta_id' });
Usuario.hasMany(EnvioEtiqueta, { foreignKey: 'usuario_id' });
EnvioEtiqueta.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Envio.hasMany(SeguimientoContacto, { as: 'contactos_seguimiento', foreignKey: 'envio_id', onDelete: 'CASCADE' });
SeguimientoContacto.belongsTo(Envio, { foreignKey: 'envio_id' });
WhatsappPlantilla.hasMany(SeguimientoContacto, { foreignKey: 'plantilla_id', onDelete: 'SET NULL' });
SeguimientoContacto.belongsTo(WhatsappPlantilla, { as: 'plantilla', foreignKey: 'plantilla_id' });

// SET NULL y no CASCADE: borrar un flujo o una fase NUNCA puede borrar el
// historial de lo que ya se le mando al cliente. El contacto conserva
// mensaje_generado como snapshot, asi que la timeline sobrevive igual.
WhatsappFlujo.hasMany(SeguimientoContacto, { foreignKey: 'flujo_id', onDelete: 'SET NULL' });
SeguimientoContacto.belongsTo(WhatsappFlujo, { as: 'flujo', foreignKey: 'flujo_id' });
WhatsappFlujoFase.hasMany(SeguimientoContacto, { as: 'envios', foreignKey: 'fase_id', onDelete: 'SET NULL' });
SeguimientoContacto.belongsTo(WhatsappFlujoFase, { as: 'fase', foreignKey: 'fase_id' });
SeguimientoEtiqueta.hasMany(SeguimientoContacto, { foreignKey: 'etiqueta_id', onDelete: 'SET NULL' });
SeguimientoContacto.belongsTo(SeguimientoEtiqueta, { as: 'etiqueta', foreignKey: 'etiqueta_id' });
Usuario.hasMany(SeguimientoContacto, { foreignKey: 'usuario_id' });
SeguimientoContacto.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Envio.hasMany(SeguimientoRecordatorio, { as: 'recordatorios', foreignKey: 'envio_id', onDelete: 'CASCADE' });
SeguimientoRecordatorio.belongsTo(Envio, { foreignKey: 'envio_id' });
Usuario.hasMany(SeguimientoRecordatorio, { foreignKey: 'usuario_id' });
SeguimientoRecordatorio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Usuario.hasMany(Notificacion, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
Notificacion.belongsTo(Usuario, { foreignKey: 'usuario_id' });
Envio.hasMany(Notificacion, { foreignKey: 'envio_id', onDelete: 'SET NULL' });
Notificacion.belongsTo(Envio, { foreignKey: 'envio_id' });

Usuario.hasOne(SeguimientoConfiguracion, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
SeguimientoConfiguracion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

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

// Opciones/Valores (tipo Shopify) — generan la combinatoria de variantes.
// producto_variantes no cambia: sigue siendo la entidad comercial real.
Producto.hasMany(ProductoOpcion, { as: 'opciones', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoOpcion.belongsTo(Producto, { foreignKey: 'producto_id' });

ProductoOpcion.hasMany(ProductoOpcionValor, { as: 'valores', foreignKey: 'opcion_id', onDelete: 'CASCADE' });
ProductoOpcionValor.belongsTo(ProductoOpcion, { as: 'opcion', foreignKey: 'opcion_id' });

ProductoVariante.belongsToMany(ProductoOpcionValor, {
  through: ProductoVarianteValor, as: 'valoresOpcion', foreignKey: 'variante_id', otherKey: 'opcion_valor_id',
});
ProductoOpcionValor.belongsToMany(ProductoVariante, {
  through: ProductoVarianteValor, as: 'variantes', foreignKey: 'opcion_valor_id', otherKey: 'variante_id',
});

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

ProductoCombo.hasMany(ProductoComboImagen, { as: 'imagenes', foreignKey: 'combo_id', onDelete: 'CASCADE' });
ProductoComboImagen.belongsTo(ProductoCombo, { foreignKey: 'combo_id' });

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

OfertaComponente.belongsTo(ProductoVariante, { as: 'variante', foreignKey: 'variante_id' });

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

// Tienda: 1:N con Usuario (un usuario puede tener varias), dueña de las landings públicas
Usuario.hasMany(Tienda, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
Tienda.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Tienda.hasMany(Landing, { as: 'landings', foreignKey: 'tienda_id', onDelete: 'CASCADE' });
Landing.belongsTo(Tienda, { foreignKey: 'tienda_id' });

Landing.hasMany(LandingItem, { as: 'items', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingItem.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(LandingSeccion, { as: 'secciones', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingSeccion.belongsTo(Landing, { foreignKey: 'landing_id' });

LandingTemplate.hasMany(Landing, { as: 'landings', foreignKey: 'template_id' });
Landing.belongsTo(LandingTemplate, { as: 'template', foreignKey: 'template_id' });

// Las landings legacy de producto usan producto_id. En el resto de las
// landings producto_id es null.
Landing.belongsTo(Producto, { as: 'producto', foreignKey: 'producto_id' });

// Relación de productos con landings (page-builder)
Landing.hasMany(LandingEvento, { as: 'eventos', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingEvento.belongsTo(Landing, { foreignKey: 'landing_id' });

// SET NULL y no CASCADE, a diferencia de los eventos de arriba: borrar una
// landing borra su tráfico (es de esa página) pero NUNCA sus ventas. El
// pedido pierde la atribución y pasa a contarse como "Sin landing".
Landing.hasMany(Envio, { as: 'pedidos', foreignKey: 'landing_id', onDelete: 'SET NULL' });
Envio.belongsTo(Landing, { as: 'landing', foreignKey: 'landing_id' });

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
// SET NULL en las tres direcciones: borrar una integración de Meta, una
// landing vinculada o un import no debe llevarse puesta la campaña interna
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
// Relaciones de Control financiero (Finanzas)
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
// ⚠️ BuilderFunnel es el módulo de secuencias de páginas del Page Builder.
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

// ── Planes y suscripciones de Gesicomm ──────────────────────────────────
// Ojo con usuario_id: es nullable a propósito (se paga ANTES de registrarse),
// así que la relación con Usuario es opcional. Ver Suscripcion.js.
Plan.hasMany(Suscripcion, { foreignKey: 'plan_id' });
Suscripcion.belongsTo(Plan, { foreignKey: 'plan_id' });

Usuario.hasMany(Suscripcion, { foreignKey: 'usuario_id' });
Suscripcion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Plan.hasMany(CheckoutIntent, { foreignKey: 'plan_id' });
CheckoutIntent.belongsTo(Plan, { foreignKey: 'plan_id' });
Usuario.hasMany(CheckoutIntent, { foreignKey: 'usuario_id' });
CheckoutIntent.belongsTo(Usuario, { foreignKey: 'usuario_id' });
Afiliado.hasMany(CheckoutIntent, { as: 'checkout_intents', foreignKey: 'affiliate_id', onDelete: 'SET NULL' });
CheckoutIntent.belongsTo(Afiliado, { as: 'affiliate', foreignKey: 'affiliate_id' });

CheckoutIntent.hasMany(SubscriptionPurchase, { as: 'purchases', foreignKey: 'checkout_intent_id', onDelete: 'RESTRICT' });
SubscriptionPurchase.belongsTo(CheckoutIntent, { as: 'checkout_intent', foreignKey: 'checkout_intent_id' });
Plan.hasMany(SubscriptionPurchase, { foreignKey: 'plan_id' });
SubscriptionPurchase.belongsTo(Plan, { foreignKey: 'plan_id' });
Usuario.hasMany(SubscriptionPurchase, { foreignKey: 'usuario_id' });
SubscriptionPurchase.belongsTo(Usuario, { foreignKey: 'usuario_id' });
Afiliado.hasMany(SubscriptionPurchase, { as: 'subscription_purchases', foreignKey: 'affiliate_id', onDelete: 'SET NULL' });
SubscriptionPurchase.belongsTo(Afiliado, { as: 'affiliate', foreignKey: 'affiliate_id' });

Suscripcion.hasMany(PagoSuscripcion, { as: 'pagos', foreignKey: 'suscripcion_id', onDelete: 'CASCADE' });
PagoSuscripcion.belongsTo(Suscripcion, { foreignKey: 'suscripcion_id' });
SubscriptionPurchase.hasMany(PagoSuscripcion, { as: 'pagos', foreignKey: 'subscription_purchase_id', onDelete: 'SET NULL' });
PagoSuscripcion.belongsTo(SubscriptionPurchase, { as: 'subscription_purchase', foreignKey: 'subscription_purchase_id' });

Afiliado.hasMany(Suscripcion, { as: 'suscripciones_referidas', foreignKey: 'afiliado_id', onDelete: 'SET NULL' });
Suscripcion.belongsTo(Afiliado, { as: 'afiliado', foreignKey: 'afiliado_id' });

Usuario.hasOne(Afiliado, { as: 'afiliado', foreignKey: 'usuario_id', onDelete: 'SET NULL' });
Afiliado.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });
Usuario.belongsTo(Afiliado, { as: 'afiliado_atribucion', foreignKey: 'affiliate_id' });
Afiliado.hasMany(Usuario, { as: 'usuarios_atribuidos', foreignKey: 'affiliate_id', onDelete: 'SET NULL' });

Afiliado.hasMany(AfiliadoClick, { as: 'clicks', foreignKey: 'afiliado_id', onDelete: 'CASCADE' });
AfiliadoClick.belongsTo(Afiliado, { as: 'afiliado', foreignKey: 'afiliado_id' });

Afiliado.hasMany(AfiliadoComision, { as: 'comisiones', foreignKey: 'afiliado_id', onDelete: 'CASCADE' });
AfiliadoComision.belongsTo(Afiliado, { as: 'afiliado', foreignKey: 'afiliado_id' });
Suscripcion.hasMany(AfiliadoComision, { as: 'comisiones_afiliado', foreignKey: 'suscripcion_id', onDelete: 'CASCADE' });
AfiliadoComision.belongsTo(Suscripcion, { as: 'suscripcion', foreignKey: 'suscripcion_id' });
PagoSuscripcion.hasOne(AfiliadoComision, { as: 'comision_afiliado', foreignKey: 'pago_suscripcion_id', onDelete: 'SET NULL' });
AfiliadoComision.belongsTo(PagoSuscripcion, { as: 'pago', foreignKey: 'pago_suscripcion_id' });

// ── Seguridad y auditoría de autenticación ──────────────────────────────
Usuario.hasMany(AuthEvent, { as: 'eventos_auth', foreignKey: 'usuario_id', onDelete: 'SET NULL' });
AuthEvent.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });

Usuario.hasMany(UserSession, { as: 'sesiones', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
UserSession.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });

UserSession.hasMany(AuthEvent, { as: 'eventos', foreignKey: 'session_id', onDelete: 'SET NULL' });
AuthEvent.belongsTo(UserSession, { as: 'sesion', foreignKey: 'session_id' });

Usuario.hasMany(AuthNotification, { as: 'notificaciones_auth', foreignKey: 'usuario_id', onDelete: 'SET NULL' });
AuthNotification.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });
AuthEvent.hasMany(AuthNotification, { as: 'notificaciones', foreignKey: 'auth_event_id', onDelete: 'SET NULL' });
AuthNotification.belongsTo(AuthEvent, { as: 'evento', foreignKey: 'auth_event_id' });

Usuario.hasMany(NotificationEvent, { as: 'notification_events', foreignKey: 'usuario_id', onDelete: 'SET NULL' });
NotificationEvent.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });
Envio.hasMany(NotificationEvent, { as: 'notification_events', foreignKey: 'envio_id', onDelete: 'SET NULL' });
NotificationEvent.belongsTo(Envio, { as: 'envio', foreignKey: 'envio_id' });

// ============================================================
// Relaciones de Inventario y Fulfillment (CP-06)
// ============================================================

// InventarioUbicacion
Usuario.hasMany(InventarioUbicacion, { foreignKey: 'usuario_id' });
InventarioUbicacion.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Producto.hasMany(InventarioUbicacion, { foreignKey: 'producto_id' });
InventarioUbicacion.belongsTo(Producto, { foreignKey: 'producto_id' });

ProductoVariante.hasMany(InventarioUbicacion, { foreignKey: 'variante_id' });
InventarioUbicacion.belongsTo(ProductoVariante, { foreignKey: 'variante_id' });

Deposito.hasMany(InventarioUbicacion, { foreignKey: 'deposito_id' });
InventarioUbicacion.belongsTo(Deposito, { foreignKey: 'deposito_id' });

// IngresoInventario
Usuario.hasMany(IngresoInventario, { foreignKey: 'usuario_id' });
IngresoInventario.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Deposito.hasMany(IngresoInventario, { foreignKey: 'centro_gesicomm_id' });
IngresoInventario.belongsTo(Deposito, { as: 'centro', foreignKey: 'centro_gesicomm_id' });

// IngresoInventarioItem
IngresoInventario.hasMany(IngresoInventarioItem, { as: 'items', foreignKey: 'ingreso_id', onDelete: 'CASCADE' });
IngresoInventarioItem.belongsTo(IngresoInventario, { foreignKey: 'ingreso_id' });

Producto.hasMany(IngresoInventarioItem, { foreignKey: 'producto_id' });
IngresoInventarioItem.belongsTo(Producto, { foreignKey: 'producto_id' });

ProductoVariante.hasMany(IngresoInventarioItem, { foreignKey: 'variante_id' });
IngresoInventarioItem.belongsTo(ProductoVariante, { foreignKey: 'variante_id' });

// HistorialIngresoInventario
IngresoInventario.hasMany(HistorialIngresoInventario, { as: 'historial', foreignKey: 'ingreso_id', onDelete: 'CASCADE' });
HistorialIngresoInventario.belongsTo(IngresoInventario, { foreignKey: 'ingreso_id' });

Usuario.hasMany(HistorialIngresoInventario, { foreignKey: 'usuario_id' });
HistorialIngresoInventario.belongsTo(Usuario, { foreignKey: 'usuario_id' });

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
  ProductoOpcion,
  ProductoOpcionValor,
  ProductoVarianteValor,
  ProductoImagen,
  ProductoFaq,
  ProductoCombo,
  ProductoComboItem,
  ProductoComboImagen,
  ProductoRelacionado,
  HistorialPrecio,
  ComboConfiguracion,
  Oferta,
  OfertaComponente,
  Courier,
  CourierAcceso,
  DeliveryZonaTarifa,
  Pais,
  Departamento,
  Ciudad,
  Deposito,
  DepositoCourier,
  ProveedorLogistico,
  CentroProveedorLogistico,
  Envio,
  EnvioItem,
  EnvioItemComponente,
  EnvioIntentoEntrega,
  MetodoPago,
  Liquidacion,
  LiquidacionEnvio,
  EnvioHistorial,
  PrecioUsuario,
  Tienda,
  SpeedboxTienda,
  SpeedboxPedido,
  SpeedboxEvento,
  RahaSolicitud,
  RahaDocumento,
  LandingTemplate,
  Landing,
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
  GsqlModulo,
  SolicitudEliminacion,
  MensajeContacto,
  MetaCampanaInterna,
  MetaReporteImport,
  MetaReporteFila,
  Proveedor,
  CategoriaCostoGasto,
  CanalVenta,
  Cupon,
  CuponProducto,
  CostoGasto,
  BuilderProject,
  BuilderFunnel,
  BuilderPage,
  BuilderPageVersion,
  BuilderFunnelPage,
  BuilderDomain,
  PaymentGateway,
  PaymentTransaction,
  ProveedorDns,
  Plan,
  CheckoutIntent,
  SubscriptionPurchase,
  Suscripcion,
  PagoSuscripcion,
  Parametro,
  Afiliado,
  AfiliadoClick,
  AfiliadoComision,
  AuthEvent,
  UserSession,
  AuthNotification,
  NotificationEvent,
  WhatsappPlantilla,
  WhatsappFlujo,
  WhatsappFlujoFase,
  SeguimientoEtiqueta,
  EnvioEtiqueta,
  SeguimientoContacto,
  SeguimientoRecordatorio,
  Notificacion,
  SeguimientoConfiguracion,
  InventarioUbicacion,
  IngresoInventario,
  IngresoInventarioItem,
  SolicitudAbastecimiento,
  HistorialSolicitudAbastecimiento,
  HistorialIngresoInventario,
  Page,
  PageVersion,
  AiGenerationLog,
};

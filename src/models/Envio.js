const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Envio = sequelize.define('Envio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tienda_id: {
    // De qué Tienda vino el pedido, para cuentas con 2+ tiendas (ver
    // migracion 20261006130000). Nullable: pedidos viejos sin backfill
    // posible quedan sin tienda asignada.
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  numero_pedido: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Número visible y correlativo por usuario/tienda. El id global queda como identificador técnico interno.',
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  proveedor_logistico_id: {
    // Distinto de courier_id: un proveedor logistico es de la red propia
    // de Gesicomm (sin usuario_id), no del comercio. Ver migracion
    // 20260923140000.
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  fecha: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  hora: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  confirmador: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  cliente: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Cliente',
  },
  nombre_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  apellido_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  ciudad: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  referencia: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  link_maps: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  monto: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  costo_envio: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo logístico de última milla o transporte hasta el cliente final.',
  },
  costo_fulfillment: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo operativo cobrado al comercio por el servicio de almacenamiento, picking, packing, etc. Separado del envío.',
  },
  delivery_a_cargo: {
    // STRING y no ENUM: en Postgres, DataTypes.ENUM crea un tipo nativo,
    // pero la columna real es VARCHAR(10) con un CHECK (ver migración
    // 20260908230000). Declararlo como ENUM haría que el modelo y la base
    // describan cosas distintas, y cualquier sync/validación de esquema
    // intentaría "arreglar" una diferencia que no existe.
    type: DataTypes.STRING(10),
    allowNull: true,
    defaultValue: 'cliente',
    validate: { isIn: [['cliente', 'negocio']] },
    comment: "Quién paga el flete. 'cliente': plata de paso, no baja la utilidad. 'negocio': es un costo de venta. NULL: pedido anterior a la columna, los reportes lo leen como 'cliente' (ver migración 20260908230000).",
  },
  pago_anticipado: {
    // Dato PROPIO, sin relación con metodo_pago_id — antes de esta columna
    // vivía escondido dentro del catálogo de Métodos de Pago (flag
    // es_anticipado de cada método) y solo se usaba al vuelo para elegir
    // tarifa de courier, nunca se guardaba. Ver migración 20260909170000.
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
    comment: 'true = el cliente ya pagó antes de recibir el pedido. false = paga contra entrega. NULL = pedido anterior a la columna, no se registró.',
  },
  metodo_pago: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: null,
  },
  observaciones: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Pendiente',
  },
  dispatchedAt: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  fecha_rendicion: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // --- Atribución comercial y canales (Escalabilidad ERP) ---
  // Valor histórico de texto libre. Se conserva como snapshot de los
  // pedidos anteriores al catálogo de canales; lo que manda ahora es
  // canal_venta_id (ver CanalVenta).
  origen: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'WEB',
  },
  canal_venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Cupón usado en el checkout. Se guarda el id (para poder cruzar contra
  // el cupón) y además el código y el importe como SNAPSHOT: si después se
  // borra o se edita el cupón, el pedido tiene que seguir explicando por
  // qué se cobró lo que se cobró.
  cupon_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  cupon_codigo: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  cupon_descuento: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Guaraníes efectivamente descontados por el cupón.',
  },
  campaign_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  campaign_id: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  adset: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  ad: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  utm_source: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  utm_medium: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  utm_campaign: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // --- Estados disociados: Comercial (Confirmador) vs Logístico (Courier) ---
  estado_comercial: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Confirmado',
  },
  estado_logistico: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Pendiente',
  },
  // --- Checkout público (landing) ---
  // De QUÉ landing vino el pedido. NULL en todo lo cargado a mano y en los
  // pedidos anteriores a esta columna: hasta entonces solo se guardaba
  // `origen: 'LANDING'`, que dice que vino de una landing pero no de cuál.
  // El dashboard agrupa esos NULL como "Sin landing" en vez de repartirlos
  // (ver migrar-landing-id-envios.js). Si la landing se borra, esto queda en
  // NULL y el pedido sobrevive — es plata cobrada, no tráfico.
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  documento: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'Cedula del comprador. La pide PagoPar para cobrar online, independientemente de si quiere factura.',
  },
  ruc: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'RUC opcional para factura virtual — contexto Paraguay.',
  },
  // --- Facturación del pedido ---
  quiere_factura: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  razon_social: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  nro_comprobante: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Único por usuario cuando está presente (ver índice parcial en migrar-metodos-pago-y-factura.js).',
  },
  // --- Método de pago (ABM) ---
  metodo_pago_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  comision_pct_aplicada: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Snapshot del % de comisión del método de pago vigente al crear el pedido, para no alterar reportes históricos si luego se edita el ABM.',
  },
  stock_descontado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Guarda de idempotencia: el stock se descuenta una sola vez, al pasar a Confirmado (ver envioController.updateEstado), sin importar cuántas veces el pedido pase por ese estado.',
  },
  // --- Gestión de Pedidos: estado operativo (9 valores) vs financiero ---
  // estado sigue siendo el operativo de siempre — ver lib/courier.js (frontend)
  // para el catálogo autoritativo: Pendiente/Confirmado/Preparado/Despachado/
  // Reprogramado/Entregado/Cancelado/Devuelto/Perdido. "Rendido" ya NO es un
  // valor válido de estado — pasa a ser estado_financiero='liquidado'.
  estado_financiero: {
    type: DataTypes.ENUM('pendiente_liquidacion', 'liquidado'),
    allowNull: false,
    defaultValue: 'pendiente_liquidacion',
  },
  fecha_reprogramada: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Obligatoria al pasar a estado Reprogramado.',
  },
  motivo_reprogramacion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  stock_despachado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Guarda de idempotencia: mueve stock reservado→tránsito una sola vez, al pasar a Despachado.',
  },
  stock_liberado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Guarda de idempotencia: libera stock reservado/en tránsito una sola vez, al cancelar.',
  },
  cargo_perdida_courier: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Snapshot: valor de venta de lo perdido − costo de envío, calculado al registrar la pérdida. Lo usa el motor de rendición.',
  },
  abastecimiento_estado: {
    type: DataTypes.STRING(60),
    allowNull: false,
    defaultValue: 'no_requiere',
    validate: { isIn: [[
      'no_requiere',
      'pendiente_pago',
      'pago_enviado',
      'pago_rechazado',
      'pago_validado',
      'proveedor_contactado',
      'enviado_por_proveedor',
      'en_transito_a_gesicomm',
      'recibido_en_gesicomm',
      'preparando_envio_a_deposito_cliente',
      'despachado_a_deposito_cliente',
      'en_transito_a_deposito_cliente',
      'recibido_en_deposito_cliente',
      'disponible_en_gesicomm',
    ]] },
    comment: 'Pipeline de seguimiento de abastecimiento Gesicom. Ver services/abastecimiento/estadoMachine.js para las transiciones válidas por actor.',
  },
  abastecimiento_costo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo estimado a pagar a Gesicom para abastecer los productos de catalogo del pedido.',
  },
  abastecimiento_pagado_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Momento en que el pago se valida (abastecimiento_estado pasa a pago_validado).',
  },
  abastecimiento_recibido_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Momento en que la mercadería llega a Gesicomm (abastecimiento_estado pasa a recibido_en_gesicomm).',
  },
  abastecimiento_notificado_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  abastecimiento_comprobante_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'URL pública (R2) del último comprobante de transferencia subido por la tienda.',
  },
  abastecimiento_comprobante_storage_key: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  abastecimiento_pago_enviado_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  abastecimiento_pago_rechazo_motivo: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Motivo cargado por el admin al rechazar el comprobante. Se limpia al reenviar.',
  },
  tipo_logistica_abastecimiento: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['GESICOMM', 'PROPIA']] },
    comment: 'Si el comercio vende stock prestado y necesita que se lo envíen a su propio depósito o si el fulfillment lo hace Gesicomm directo.',
  },
  ruta_abastecimiento: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'VIA_GESICOMM',
    validate: { isIn: [['VIA_GESICOMM', 'DIRECTA']] },
    comment: 'Ruta física del paquete desde el proveedor hasta el depósito destino.',
  },
  deposito_destino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  deposito_destino_nombre: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  destino_departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  destino_ciudad: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  destino_direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  destino_referencia: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  destino_persona_contacto: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  destino_telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  destino_google_maps_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
}, {
  tableName: 'envios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'idx_envios_analytics_fecha',
      fields: ['usuario_id', 'fecha']
    },
    {
      name: 'idx_envios_analytics_dispatchedAt',
      fields: ['usuario_id', 'dispatchedAt']
    },
    {
      name: 'uq_envios_usuario_numero_pedido',
      unique: true,
      fields: ['usuario_id', 'numero_pedido']
    }
  ]
});

module.exports = Envio;

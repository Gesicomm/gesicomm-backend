const { ModuloEducacion, LeccionEducacion, Examen, PreguntaExamen, sequelize } = require('../src/models');

async function seedJourney() {
  const transaction = await sequelize.transaction();
  try {
    console.log('--- Limpiando e inicializando módulos educativos con lecciones multi-video ---');

    await PreguntaExamen.destroy({ where: {}, truncate: false, cascade: true, transaction });
    await Examen.destroy({ where: {}, truncate: false, cascade: true, transaction });
    await LeccionEducacion.destroy({ where: {}, truncate: false, cascade: true, transaction });
    await ModuloEducacion.destroy({ where: {}, truncate: false, cascade: true, transaction });

    // -------------------------------------------------------------
    // Módulo 1: Fundamentos de E-commerce y Landing Pages
    // -------------------------------------------------------------
    const m1 = await ModuloEducacion.create({
      titulo: 'Fundamentos de E-commerce y tu Tienda Gesicomm',
      descripcion: 'Domina los conceptos clave para configurar tu tienda online, estructurar ofertas irresistibles y crear landing pages de alta conversión.',
      orden: 1,
      duracion_minutos: 15,
      icono: '🚀',
      color_accent: '#3b82f6',
      estado: 'publicado',
      menu_desbloqueado: 'mi-landing',
      activo: true,
      recursos_descarga: [
        { titulo: 'Guía de Arquitectura de Landing Pages (PDF)', url: 'https://ejemplo.com/guia-landing.pdf', tipo: 'pdf' },
        { titulo: 'Plantilla de Copywriting de Ofertas', url: 'https://ejemplo.com/copywriting.txt', tipo: 'link' }
      ]
    }, { transaction });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: m1.id,
        titulo: 'Clase 1: Configuración de la Tienda y Parámetros Iniciales',
        descripcion: 'Aprende a ajustar tus datos comerciales, métodos de pago y marca visual en Gesicomm.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 5,
        orden: 1,
        tipo: 'video'
      },
      {
        modulo_id: m1.id,
        titulo: 'Clase 2: Estructura de una Landing Page de Alta Conversión',
        descripcion: 'Elementos esenciales: llamado a la acción, prueba social, formulario contraentrega y velocidad de carga.',
        url_video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_min: 6,
        orden: 2,
        tipo: 'video'
      },
      {
        modulo_id: m1.id,
        titulo: 'Clase 3: Estrategias de Combos y Descuentos Escalonados',
        descripcion: 'Cómo configurar combos (1x, 2x, 3x) para disparar el ticket promedio de compra.',
        url_video: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        duracion_min: 4,
        orden: 3,
        tipo: 'video'
      }
    ], { transaction });

    const ex1 = await Examen.create({
      modulo_id: m1.id,
      titulo: 'Evaluación: Fundamentos y Landing Pages',
      descripcion: 'Valida tus conocimientos sobre optimización de páginas de venta y ofertas para desbloquear la herramienta de Landing Pages.',
      puntaje_minimo: 80,
      activo: true,
    }, { transaction });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex1.id,
        pregunta: '¿Cuál es el objetivo principal de una landing page optimizada en Gesicomm?',
        opciones: [
          { id: 'A', texto: 'Mostrar la historia completa de la empresa sin botones de compra' },
          { id: 'B', texto: 'Guiar al visitante hacia una única acción clara de compra sin distracciones' },
          { id: 'C', texto: 'Tener la mayor cantidad de enlaces a redes sociales externos' },
          { id: 'D', texto: 'Ocultar los precios de los productos' }
        ],
        respuesta_correcta: 'B',
        explicacion: 'Una landing page efectiva elimina fugas y concentra la atención del usuario en una propuesta de valor y un llamado a la acción directo.',
        orden: 1,
      },
      {
        examen_id: ex1.id,
        pregunta: '¿Es posible crear combos y promociones por cantidad para aumentar el ticket promedio?',
        opciones: [
          { id: 'V', texto: 'Verdadero' },
          { id: 'F', texto: 'Falso' }
        ],
        respuesta_correcta: 'V',
        explicacion: 'Gesicomm permite configurar combos con descuentos escalonados para incentivar a los clientes a llevar más unidades por pedido.',
        orden: 2,
      },
      {
        examen_id: ex1.id,
        pregunta: '¿Qué información es fundamental que el cliente ingrese al solicitar contraentrega?',
        opciones: [
          { id: 'A', texto: 'Solo su correo electrónico' },
          { id: 'B', texto: 'Nombre, teléfono verificado, ciudad y dirección exacta con referencias' },
          { id: 'C', texto: 'Número de tarjeta de crédito' }
        ],
        respuesta_correcta: 'B',
        explicacion: 'Para entregas contra entrega efectivas, los datos de contacto y ubicación precisa son indispensables para coordinar con el courier.',
        orden: 3,
      }
    ], { transaction });

    // -------------------------------------------------------------
    // Módulo 2: Meta Ads & Tráfico Pago
    // -------------------------------------------------------------
    const m2 = await ModuloEducacion.create({
      titulo: 'Creación y Optimización de Campañas en Meta Ads',
      descripcion: 'Aprende a integrar el Pixel y Conversions API (CAPI), estructurar campañas de ventas y medir el costo por adquisición (CPA).',
      orden: 2,
      duracion_minutos: 14,
      icono: '🎯',
      color_accent: '#8b5cf6',
      estado: 'publicado',
      menu_desbloqueado: 'ads',
      activo: true,
    }, { transaction });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: m2.id,
        titulo: 'Clase 1: Integración de Meta Pixel y Conversions API (CAPI)',
        descripcion: 'Conexión server-side para evitar pérdidas de eventos por bloqueadores y cookies de terceros.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 7,
        orden: 1,
        tipo: 'video'
      },
      {
        modulo_id: m2.id,
        titulo: 'Clase 2: Estructura de Campañas ABO vs CBO y Públicos',
        descripcion: 'Cómo organizar conjuntos de anuncios y presupuestos para maximizar el ROAS.',
        url_video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_min: 7,
        orden: 2,
        tipo: 'video'
      }
    ], { transaction });

    const ex2 = await Examen.create({
      modulo_id: m2.id,
      titulo: 'Evaluación: Estrategia de Publicidad Digital',
      descripcion: 'Valida tus conocimientos sobre segmentación, eventos de conversión y métricas publicitarias.',
      puntaje_minimo: 80,
      activo: true,
    }, { transaction });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex2.id,
        pregunta: '¿Por qué es crucial integrar Conversions API (CAPI) junto al Pixel de Meta?',
        opciones: [
          { id: 'A', texto: 'Para duplicar el gasto publicitario' },
          { id: 'B', texto: 'Para enviar eventos de compra confiables directamente desde el servidor evitando bloqueos' },
          { id: 'C', texto: 'Solo sirve para cuentas con más de 10.000 seguidores' }
        ],
        respuesta_correcta: 'B',
        explicacion: 'CAPI envía eventos directamente desde el backend de Gesicomm hacia Meta, garantizando una atribución precisa.',
        orden: 1,
      },
      {
        examen_id: ex2.id,
        pregunta: 'El evento "Purchase" en Gesicomm se dispara automáticamente cuando un cliente completa su pedido.',
        opciones: [
          { id: 'V', texto: 'Verdadero' },
          { id: 'F', texto: 'Falso' }
        ],
        respuesta_correcta: 'V',
        explicacion: 'Gesicomm envía el evento Purchase enriquecido con valor monetario y datos del cliente.',
        orden: 2,
      }
    ], { transaction });

    // -------------------------------------------------------------
    // Módulo 3: Logística y Couriers
    // -------------------------------------------------------------
    const m3 = await ModuloEducacion.create({
      titulo: 'Gestión Logística, Couriers y Envíos Eficientes',
      descripcion: 'Configura tarifas de envío por rangos de productos, gestiona estados de pedidos y optimiza la entrega contraentrega.',
      orden: 3,
      duracion_minutos: 11,
      icono: '🚚',
      color_accent: '#10b981',
      estado: 'publicado',
      menu_desbloqueado: 'pedidos',
      activo: true,
    }, { transaction });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: m3.id,
        titulo: 'Clase 1: Configuración de Tarifas de Courier por Rango de Unidades',
        descripcion: 'Ajuste de costos logísticos para 1-5 productos, 6-10 productos y envíos al interior.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 5,
        orden: 1,
        tipo: 'video'
      },
      {
        modulo_id: m3.id,
        titulo: 'Clase 2: Flujo Operativo: De Pendiente a Entregado y Liquidado',
        descripcion: 'Gestión ágil de estados logísticos, cancelaciones y verificación de caja neta.',
        url_video: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        duracion_min: 6,
        orden: 2,
        tipo: 'video'
      }
    ], { transaction });

    const ex3 = await Examen.create({
      modulo_id: m3.id,
      titulo: 'Evaluación: Logística y Operaciones de Despacho',
      descripcion: 'Evalúa cómo calcular tarifas de envío y gestionar los estados de pedidos con couriers.',
      puntaje_minimo: 100,
      activo: true,
    }, { transaction });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex3.id,
        pregunta: '¿Cómo calcula Gesicomm la tarifa de courier si configuras rangos de unidades (ej. 1-5 productos vs 6-10)?',
        opciones: [
          { id: 'A', texto: 'Suma el precio de cada producto al azar' },
          { id: 'B', texto: 'Calcula la cantidad total de unidades del pedido y aplica el costo del rango correspondiente' },
          { id: 'C', texto: 'Siempre cobra una tarifa fija de 100.000 Gs.' }
        ],
        respuesta_correcta: 'B',
        explicacion: 'El motor logístico suma todas las unidades del carrito y ubica el rango configurado para el courier y ciudad seleccionados.',
        orden: 1,
      }
    ], { transaction });

    await transaction.commit();
    console.log('✓ Seed de ruta de aprendizaje completado con éxito.');
    process.exit(0);
  } catch (error) {
    await transaction.rollback();
    console.error('Error al ejecutar seed de educación:', error);
    process.exit(1);
  }
}

seedJourney();

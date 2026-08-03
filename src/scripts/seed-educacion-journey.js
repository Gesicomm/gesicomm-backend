const { sequelize, ModuloEducacion, LeccionEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo, ProgresoUsuarioLeccion } = require('../models');

async function seedJourney() {
  try {
    await sequelize.authenticate();
    console.log('Conexión a BD establecida.');

    // Limpiar módulos y lecciones previas para inicializar el Journey perfecto
    await PreguntaExamen.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});
    await Examen.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});
    await ProgresoUsuarioLeccion.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});
    await ProgresoUsuarioModulo.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});
    await LeccionEducacion.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});
    await ModuloEducacion.destroy({ where: {}, truncate: { cascade: true } }).catch(() => {});

    console.log('Creando Módulo 1: Fundamentos del E-commerce & Landing Pages...');
    const mod1 = await ModuloEducacion.create({
      titulo: 'Fundamentos del E-commerce & Landing Pages',
      descripcion: 'Aprende las bases para estructurar ofertas irresistibles, crear páginas de venta de alta conversión y configurar tus medios de cobro.',
      icono: '🚀',
      color_accent: '#3b82f6',
      estado: 'publicado',
      duracion_minutos: 15,
      orden: 1,
      menu_desbloqueado: 'mi-landing',
    });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: mod1.id,
        titulo: 'Clase 1: Anatomía de una Landing Page que vende',
        descripcion: 'Estructura de titulares, llamado a la acción y prueba social.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 7,
        orden: 1,
        tipo: 'video',
      },
      {
        modulo_id: mod1.id,
        titulo: 'Clase 2: Estrategia de Precios, Descuentos y Combos',
        descripcion: 'Cómo incrementar el ticket promedio en e-commerce.',
        url_video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_min: 8,
        orden: 2,
        tipo: 'video',
      },
    ]);

    const exam1 = await Examen.create({
      modulo_id: mod1.id,
      titulo: 'Certificación: Estrategias de Venta & Landing Pages',
      descripcion: 'Responde correctamente las preguntas para validar tu aprendizaje y desbloquear el Constructor de Landing Pages.',
      puntaje_minimo: 75,
    });

    await PreguntaExamen.create({
      examen_id: exam1.id,
      pregunta: '¿Cuál es el elemento principal para capturar la atención en los primeros 3 segundos de una Landing Page?',
      opciones: [
        { id: 'A', texto: 'Un titular claro con la propuesta de valor y beneficio' },
        { id: 'B', texto: 'Mucho texto con términos técnicos complejos' },
        { id: 'C', texto: 'Ocultar los precios y métodos de entrega' },
      ],
      respuesta_correcta: 'A',
      explicacion: 'El titular principal y la propuesta de valor comunican de inmediato el beneficio al visitante.',
      orden: 1,
    });

    await PreguntaExamen.create({
      examen_id: exam1.id,
      pregunta: '¿Por qué ofrecer ofertas tipo combo o paquetes aumenta la rentabilidad del negocio?',
      opciones: [
        { id: 'A', texto: 'Porque reduce la variedad de productos' },
        { id: 'B', texto: 'Porque incrementa el ticket promedio por cliente y optimiza el flete' },
        { id: 'C', texto: 'No tiene ningún impacto financiero' },
      ],
      respuesta_correcta: 'B',
      explicacion: 'Los combos incrementan el ticket promedio amortizando el costo logístico de envío.',
      orden: 2,
    });

    console.log('Creando Módulo 2: Meta Ads & Tráfico Pago para Escalar...');
    const mod2 = await ModuloEducacion.create({
      titulo: 'Meta Ads & Tráfico Pago para Escalar',
      descripcion: 'Domina la configuración de Pixel, Conversion API, creativos ganadores y optimización de presupuesto en anuncios de Facebook e Instagram.',
      icono: '🎯',
      color_accent: '#f59e0b',
      estado: 'publicado',
      duracion_minutos: 20,
      orden: 2,
      menu_desbloqueado: 'ads',
    });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: mod2.id,
        titulo: 'Clase 1: Configuración de Pixel & API de Conversiones',
        descripcion: 'Seguimiento exacto de eventos de compra en tiempo real.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 10,
        orden: 1,
        tipo: 'video',
      },
      {
        modulo_id: mod2.id,
        titulo: 'Clase 2: Creativos Ganadores & Segmentación',
        descripcion: 'Estructura de anuncios de alto impacto visual.',
        url_video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_min: 10,
        orden: 2,
        tipo: 'video',
      },
    ]);

    const exam2 = await Examen.create({
      modulo_id: mod2.id,
      titulo: 'Evaluación: Meta Ads & Rendimiento',
      descripcion: 'Demuestra tus conocimientos en métricas publicitarias y CAPI.',
      puntaje_minimo: 80,
    });

    await PreguntaExamen.create({
      examen_id: exam2.id,
      pregunta: '¿Para qué sirve implementar Conversion API (CAPI) junto con el Pixel tradicional?',
      opciones: [
        { id: 'A', texto: 'Garantizar el envío de eventos server-side y evitar pérdida de data' },
        { id: 'B', texto: 'Aumentar automáticamente el costo de la publicidad' },
        { id: 'C', texto: 'Cambiar el color de los anuncios' },
      ],
      respuesta_correcta: 'A',
      explicacion: 'CAPI envía eventos directamente desde el servidor evitando bloqueos de navegadores y cookies.',
      orden: 1,
    });

    console.log('Creando Módulo 3: Logística, Couriers & Entrega Eficiente...');
    const mod3 = await ModuloEducacion.create({
      titulo: 'Logística, Couriers & Entrega Eficiente',
      descripcion: 'Aprende a configurar tarifas de envío por rangos de cantidad, gestionar despachos y minimizar devoluciones.',
      icono: '🚚',
      color_accent: '#10b981',
      estado: 'publicado',
      duracion_minutos: 12,
      orden: 3,
      menu_desbloqueado: 'pedidos',
    });

    await LeccionEducacion.bulkCreate([
      {
        modulo_id: mod3.id,
        titulo: 'Clase 1: Configuración de Rangos de Tarifas de Courier',
        descripcion: 'Cobros escalonados de 1-5 productos, 6-10 productos, etc.',
        url_video: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
        duracion_min: 12,
        orden: 1,
        tipo: 'video',
      },
    ]);

    const exam3 = await Examen.create({
      modulo_id: mod3.id,
      titulo: 'Evaluación: Logística & Despacho',
      descripcion: 'Valida tu conocimiento logístico para desbloquear el control de Envíos.',
      puntaje_minimo: 80,
    });

    await PreguntaExamen.create({
      examen_id: exam3.id,
      pregunta: '¿Cómo benefician las tarifas por rango de productos a la operación de tu tienda?',
      opciones: [
        { id: 'A', texto: 'Permiten ajustar con precisión el flete según la cantidad de items' },
        { id: 'B', texto: 'Cobran siempre un valor aleatorio' },
      ],
      respuesta_correcta: 'A',
      explicacion: 'Permiten cobrar el costo de flete exacto según el volumen y peso del pedido.',
      orden: 1,
    });

    console.log('✓ Seed de Journey LMS completado con éxito!');
    process.exit(0);
  } catch (error) {
    console.error('Error al ejecutar seed de Journey:', error);
    process.exit(1);
  }
}

seedJourney();

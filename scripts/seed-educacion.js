const { ModuloEducacion, Examen, PreguntaExamen } = require('../src/models');

async function seedEducacion() {
  try {
    const totalExistentes = await ModuloEducacion.count();
    if (totalExistentes > 0) {
      console.log(`Ya existen ${totalExistentes} módulos de educación. Omitiendo seed inicial.`);
      return;
    }

    console.log('Sembrando módulos de educación y exámenes iniciales...');

    // Módulo 1
    const mod1 = await ModuloEducacion.create({
      titulo: 'Módulo 1: Fundamentos de E-commerce y tu Tienda Gesicomm',
      descripcion: 'Aprende a configurar tu tienda online, personalizar tu landing page y preparar tu catálogo para vender.',
      orden: 1,
      video_url: 'https://www.youtube.com/watch?v=1F_47Z4G6o8',
      duracion_minutos: 8,
      menu_desbloqueado: 'mi-landing',
      activo: true,
    });

    const ex1 = await Examen.create({
      modulo_id: mod1.id,
      titulo: 'Evaluación: Configuración de Landing Page',
      descripcion: 'Demuestra que comprendes los elementos clave para convertir visitantes en clientes.',
      puntaje_minimo: 70,
      activo: true,
    });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex1.id,
        pregunta: '¿Cuál es el objetivo principal de una landing page optimizada en Gesicomm?',
        tipo: 'opcion_multiple',
        opciones: [
          { id: 'A', texto: 'Mostrar la mayor cantidad de texto sin fotos' },
          { id: 'B', texto: 'Guiar al visitante a una acción clara de compra con ofertas irresistibles' },
          { id: 'C', texto: 'Cobrar una suscripción mensual a los clientes' },
          { id: 'D', texto: 'Ocultar los precios de los productos' },
        ],
        respuesta_correcta: 'B',
        explicacion: 'Una buena landing page enfoca la atención del usuario en una propuesta de valor clara y un llamado a la acción directo.',
        orden: 1,
      },
      {
        examen_id: ex1.id,
        pregunta: '¿Es posible crear combos y promociones por cantidad para aumentar el ticket promedio?',
        tipo: 'verdadero_falso',
        opciones: [
          { id: 'V', texto: 'Verdadero' },
          { id: 'F', texto: 'Falso' },
        ],
        respuesta_correcta: 'V',
        explicacion: 'Gesicomm permite configurar combos con descuentos escalonados para maximizar el valor del pedido.',
        orden: 2,
      },
      {
        examen_id: ex1.id,
        pregunta: '¿Qué información es fundamental que el cliente ingrese al solicitar contraentrega?',
        tipo: 'opcion_multiple',
        opciones: [
          { id: 'A', texto: 'Solo su correo electrónico' },
          { id: 'B', texto: 'Nombre, teléfono, dirección exacta y ciudad de entrega' },
          { id: 'C', texto: 'Número de tarjeta de crédito obligatoriamente' },
        ],
        respuesta_correcta: 'B',
        explicacion: 'Para entregas contra entrega efectivas, los datos de contacto y ubicación son indispensables.',
        orden: 3,
      },
    ]);

    // Módulo 2
    const mod2 = await ModuloEducacion.create({
      titulo: 'Módulo 2: Creación y Optimización de Campañas en Meta Ads',
      descripcion: 'Domina la integración de Meta Conversions API y la creación de anuncios que convierten con alto ROAS.',
      orden: 2,
      video_url: 'https://www.youtube.com/watch?v=y881t8ilMyc',
      duracion_minutos: 12,
      menu_desbloqueado: 'mis-anuncios',
      activo: true,
    });

    const ex2 = await Examen.create({
      modulo_id: mod2.id,
      titulo: 'Evaluación: Estrategia de Publicidad Digital',
      descripcion: 'Valida tus conocimientos sobre segmentación, eventos de conversión y métricas publicitarias.',
      puntaje_minimo: 70,
      activo: true,
    });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex2.id,
        pregunta: '¿Por qué es crucial integrar Conversions API (CAPI) junto al Pixel de Meta?',
        tipo: 'opcion_multiple',
        opciones: [
          { id: 'A', texto: 'Para duplicar el gasto publicitario' },
          { id: 'B', texto: 'Para enviar eventos de compra confiables directamente desde el servidor evitando bloqueos' },
          { id: 'C', texto: 'Solo sirve para cuentas con más de 10.000 seguidores' },
        ],
        respuesta_correcta: 'B',
        explicacion: 'Conversions API envía señales directas de servidor a servidor mejorando la atribución y optimización de tus anuncios.',
        orden: 1,
      },
      {
        examen_id: ex2.id,
        pregunta: 'El evento "Purchase" en Gesicomm se dispara automáticamente cuando un cliente completa su pedido.',
        tipo: 'verdadero_falso',
        opciones: [
          { id: 'V', texto: 'Verdadero' },
          { id: 'F', texto: 'Falso' },
        ],
        respuesta_correcta: 'V',
        explicacion: 'Gesicomm reporta el evento de compra a Meta con el valor de la orden e información del cliente de forma segura.',
        orden: 2,
      },
    ]);

    // Módulo 3
    const mod3 = await ModuloEducacion.create({
      titulo: 'Módulo 3: Gestión Logística, Courriers y Envíos Eficientes',
      descripcion: 'Aprende a configurar tarifas dinámicas por rango de productos y coordinar entregas sin fricción.',
      orden: 3,
      video_url: 'https://www.youtube.com/watch?v=XqZsoesa55w',
      duracion_minutos: 10,
      menu_desbloqueado: 'mis-pedidos',
      activo: true,
    });

    const ex3 = await Examen.create({
      modulo_id: mod3.id,
      titulo: 'Evaluación: Logística y Operaciones de Despacho',
      descripcion: 'Evalúa cómo calcular tarifas de envío y gestionar los estados de pedidos con couriers.',
      puntaje_minimo: 70,
      activo: true,
    });

    await PreguntaExamen.bulkCreate([
      {
        examen_id: ex3.id,
        pregunta: '¿Cómo calcula Gesicomm la tarifa de courier si configuras rangos de unidades (ej. 1-5 productos vs 6-10)?',
        tipo: 'opcion_multiple',
        opciones: [
          { id: 'A', texto: 'Suma el precio de cada producto al azar' },
          { id: 'B', texto: 'Calcula la cantidad total de unidades del pedido y aplica el costo del rango correspondiente' },
          { id: 'C', texto: 'Siempre cobra una tarifa fija de 100.000 Gs.' },
        ],
        respuesta_correcta: 'B',
        explicacion: 'El sistema suma las cantidades de todos los ítems y busca la tarifa cuyo rango min y max cubra la cantidad total.',
        orden: 1,
      },
    ]);

    console.log('Módulos de educación y exámenes sembrados exitosamente.');
  } catch (error) {
    console.error('Error al sembrar datos de educación:', error);
  }
}

if (require.main === module) {
  seedEducacion().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedEducacion };

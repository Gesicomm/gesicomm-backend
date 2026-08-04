const { ModuloEducacion, LeccionEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo, ProgresoUsuarioLeccion } = require('../models');

/**
 * Obtener todos los módulos de educación disponibles para el usuario,
 * calculando la secuencia de desbloqueo, el progreso de videos y exámenes por usuario.
 */
async function getModulos(req, res) {
  try {
    const usuarioId = req.usuario.id;

    // Obtener todos los módulos activos ordenados
    const modulos = await ModuloEducacion.findAll({
      where: { activo: true },
      order: [['orden', 'ASC'], ['id', 'ASC']],
      include: [
        {
          model: LeccionEducacion,
          as: 'lecciones',
          where: { activo: true },
          required: false,
        },
        {
          model: Examen,
          as: 'examen',
          where: { activo: true },
          required: false,
          include: [
            {
              model: PreguntaExamen,
              as: 'preguntas',
              attributes: ['id'], // solo conteo
            },
          ],
        },
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
          required: false,
        },
      ],
    });

    // Obtener progresos de lecciones de este usuario
    const progresosLecciones = await ProgresoUsuarioLeccion.findAll({
      where: { usuario_id: usuarioId, completado: true },
      attributes: ['leccion_id'],
    });
    const leccionesCompletadasSet = new Set(progresosLecciones.map(p => p.leccion_id));

    const completedOrders = new Set(
      modulos
        .filter(m => {
          const prog = m.progresos && m.progresos.length > 0 ? m.progresos[0] : null;
          return Boolean(prog?.completado || prog?.examen_aprobado);
        })
        .map(m => m.orden)
    );

    let anteriorCompletado = true; // El primer módulo siempre está desbloqueado
    let totalLeccionesGlobal = 0;
    let totalLeccionesCompletadas = 0;
    let modulosAprobados = 0;

    const modulosConProgreso = modulos.map((m, index) => {
      const progreso = m.progresos && m.progresos.length > 0 ? m.progresos[0] : null;
      const lecciones = (m.lecciones || []).sort((a, b) => a.orden - b.orden);
      
      const leccionesConEstado = lecciones.map(l => {
        const completada = leccionesCompletadasSet.has(l.id);
        totalLeccionesGlobal++;
        if (completada) totalLeccionesCompletadas++;
        return {
          id: l.id,
          titulo: l.titulo,
          descripcion: l.descripcion,
          url_video: l.url_video,
          duracion_min: l.duracion_min,
          orden: l.orden,
          tipo: l.tipo,
          recurso_url: l.recurso_url,
          completada,
        };
      });

      const totalLeccionesModulo = lecciones.length;
      const leccionesVistasModulo = leccionesConEstado.filter(l => l.completada).length;
      const videosCompletados = totalLeccionesModulo === 0 || leccionesVistasModulo === totalLeccionesModulo;

      // El módulo está desbloqueado si es el primero (o de orden 1), si el anterior fue aprobado, o si el orden anterior está completado
      const ordenAnteriorCompletado = m.orden > 1 && completedOrders.has(m.orden - 1);
      const desbloqueado = index === 0 || m.orden <= 1 || anteriorCompletado || ordenAnteriorCompletado;
      const examenAprobado = Boolean(progreso?.examen_aprobado);
      const completado = Boolean(progreso?.completado);

      if (examenAprobado || (!m.examen && videosCompletados)) {
        modulosAprobados++;
      }

      // Para desbloquear el siguiente en la lista directa
      anteriorCompletado = examenAprobado || (!m.examen && videosCompletados);

      // Calcular duración total acumulada de las lecciones
      const duracionTotal = lecciones.reduce((acc, l) => acc + (l.duracion_min || 0), m.duracion_minutos || 0);

      const ahora = new Date();
      const estaBloqueado = Boolean(progreso?.bloqueado_hasta && ahora < new Date(progreso.bloqueado_hasta));
      const segundosRestantes = estaBloqueado 
        ? Math.max(0, Math.ceil((new Date(progreso.bloqueado_hasta).getTime() - ahora.getTime()) / 1000))
        : 0;

      return {
        id: m.id,
        titulo: m.titulo,
        descripcion: m.descripcion,
        icono: m.icono || '🎓',
        color_accent: m.color_accent || '#3b82f6',
        estado: m.estado || 'publicado',
        orden: m.orden,
        duracion_minutos: duracionTotal,
        menu_desbloqueado: m.menu_desbloqueado,
        recursos_descarga: m.recursos_descarga || [],
        desbloqueado,
        completado,
        examen_aprobado: examenAprobado,
        puntaje_obtenido: progreso?.puntaje_obtenido ?? null,
        intentos: progreso?.intentos || 0,
        intentos_fallidos: progreso?.intentos_fallidos || 0,
        examen_bloqueado: estaBloqueado,
        bloqueado_hasta: estaBloqueado ? progreso.bloqueado_hasta : null,
        segundos_restantes_bloqueo: segundosRestantes,
        total_lecciones: totalLeccionesModulo,
        lecciones_completadas: leccionesVistasModulo,
        videos_completados: videosCompletados,
        tiene_examen: Boolean(m.examen),
        total_preguntas: m.examen?.preguntas?.length || 0,
        lecciones: leccionesConEstado,
      };
    });

    // Calcular estadísticas globales
    const totalModulos = modulosConProgreso.length;
    const porcentajeProgreso = totalLeccionesGlobal > 0
      ? Math.round(((totalLeccionesCompletadas + (modulosAprobados * 2)) / (totalLeccionesGlobal + (totalModulos * 2))) * 100)
      : (totalModulos > 0 ? Math.round((modulosAprobados / totalModulos) * 100) : 0);

    return res.json({
      modulos: modulosConProgreso,
      estadisticas: {
        total_modulos: totalModulos,
        modulos_completados: modulosAprobados,
        total_lecciones: totalLeccionesGlobal,
        lecciones_completadas: totalLeccionesCompletadas,
        porcentaje_global: Math.min(100, Math.max(0, porcentajeProgreso)),
        nivel_actual: modulosAprobados === totalModulos && totalModulos > 0
          ? 'Master E-commerce 🏆'
          : modulosAprobados > 0 ? 'En Crecimiento ⚡' : 'Iniciante 🌱',
      },
    });
  } catch (error) {
    console.error('Error al obtener módulos de educación:', error);
    return res.status(500).json({ message: 'Error interno al cargar la ruta de educación.' });
  }
}

/**
 * Obtener detalle de un módulo con todas sus lecciones y examen (sin respuestas correctas)
 */
async function getDetalleModulo(req, res) {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;

    const modulo = await ModuloEducacion.findByPk(id, {
      include: [
        {
          model: LeccionEducacion,
          as: 'lecciones',
          where: { activo: true },
          required: false,
        },
        {
          model: Examen,
          as: 'examen',
          where: { activo: true },
          required: false,
          include: [
            {
              model: PreguntaExamen,
              as: 'preguntas',
              attributes: ['id', 'pregunta', 'opciones', 'orden'],
            },
          ],
        },
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
          required: false,
        },
      ],
    });

    if (!modulo) {
      return res.status(404).json({ message: 'Módulo de educación no encontrado.' });
    }

    // Lecciones completadas por el usuario
    const progresosLecciones = await ProgresoUsuarioLeccion.findAll({
      where: { usuario_id: usuarioId, completado: true },
      attributes: ['leccion_id'],
    });
    const leccionesCompletadasSet = new Set(progresosLecciones.map(p => p.leccion_id));

    const progreso = modulo.progresos && modulo.progresos.length > 0 ? modulo.progresos[0] : null;
    const lecciones = (modulo.lecciones || []).sort((a, b) => a.orden - b.orden).map(l => ({
      id: l.id,
      titulo: l.titulo,
      descripcion: l.descripcion,
      url_video: l.url_video,
      duracion_min: l.duracion_min,
      orden: l.orden,
      tipo: l.tipo,
      recurso_url: l.recurso_url,
      completada: leccionesCompletadasSet.has(l.id),
    }));

    if (modulo.examen && modulo.examen.preguntas) {
      modulo.examen.preguntas.sort((a, b) => a.orden - b.orden);
    }

    const ahora = new Date();
    let estaBloqueado = Boolean(progreso?.bloqueado_hasta && ahora < new Date(progreso.bloqueado_hasta));
    let segundosRestantes = estaBloqueado
      ? Math.max(0, Math.ceil((new Date(progreso.bloqueado_hasta).getTime() - ahora.getTime()) / 1000))
      : 0;

    // Si ya expiró el bloqueo anterior, limpiarlo automáticamente
    if (progreso?.bloqueado_hasta && ahora >= new Date(progreso.bloqueado_hasta)) {
      progreso.bloqueado_hasta = null;
      progreso.intentos_fallidos = 0;
      await progreso.save();
      estaBloqueado = false;
      segundosRestantes = 0;
    }

    return res.json({
      id: modulo.id,
      titulo: modulo.titulo,
      descripcion: modulo.descripcion,
      icono: modulo.icono || '🎓',
      color_accent: modulo.color_accent || '#3b82f6',
      estado: modulo.estado || 'publicado',
      orden: modulo.orden,
      duracion_minutos: modulo.duracion_minutos,
      menu_desbloqueado: modulo.menu_desbloqueado,
      recursos_descarga: modulo.recursos_descarga || [],
      progreso_usuario: {
        completado: Boolean(progreso?.completado),
        examen_aprobado: Boolean(progreso?.examen_aprobado),
        puntaje_obtenido: progreso?.puntaje_obtenido ?? null,
        intentos: progreso?.intentos || 0,
        intentos_fallidos: progreso?.intentos_fallidos || 0,
        intentos_restantes: Math.max(0, 3 - (progreso?.intentos_fallidos || 0)),
        examen_bloqueado: estaBloqueado,
        bloqueado_hasta: estaBloqueado ? progreso.bloqueado_hasta : null,
        segundos_restantes_bloqueo: segundosRestantes,
      },
      lecciones,
      examen: modulo.examen || null,
    });
  } catch (error) {
    console.error('Error al obtener detalle del módulo:', error);
    return res.status(500).json({ message: 'Error interno al cargar detalle del módulo.' });
  }
}

/**
 * Marcar una lección individual como completada/vista por el usuario
 */
async function marcarLeccionCompletada(req, res) {
  try {
    const { leccionId } = req.params;
    const usuarioId = req.usuario.id;

    const leccion = await LeccionEducacion.findByPk(leccionId);
    if (!leccion) {
      return res.status(404).json({ message: 'Lección no encontrada.' });
    }

    const [progresoLeccion] = await ProgresoUsuarioLeccion.findOrCreate({
      where: { usuario_id: usuarioId, leccion_id: leccion.id },
      defaults: {
        usuario_id: usuarioId,
        leccion_id: leccion.id,
        completado: true,
        fecha_completado: new Date(),
      },
    });

    if (!progresoLeccion.completado) {
      progresoLeccion.completado = true;
      progresoLeccion.fecha_completado = new Date();
      await progresoLeccion.save();
    }

    // Verificar si todas las lecciones del módulo fueron completadas
    const totalLeccionesModulo = await LeccionEducacion.count({
      where: { modulo_id: leccion.modulo_id, activo: true },
    });

    const leccionesCompletadasModulo = await ProgresoUsuarioLeccion.count({
      where: {
        usuario_id: usuarioId,
        completado: true,
      },
      include: [
        {
          model: LeccionEducacion,
          as: 'leccion',
          where: { modulo_id: leccion.modulo_id, activo: true },
          required: true,
        },
      ],
    });

    const todasLeccionesCompletadas = leccionesCompletadasModulo >= totalLeccionesModulo;

    // Actualizar progreso del módulo
    let [progresoModulo] = await ProgresoUsuarioModulo.findOrCreate({
      where: { usuario_id: usuarioId, modulo_id: leccion.modulo_id },
      defaults: {
        usuario_id: usuarioId,
        modulo_id: leccion.modulo_id,
        video_completado: todasLeccionesCompletadas,
      },
    });

    if (todasLeccionesCompletadas && !progresoModulo.video_completado) {
      progresoModulo.video_completado = true;
      await progresoModulo.save();
    }

    return res.json({
      success: true,
      leccion_id: leccion.id,
      completado: true,
      todas_lecciones_completadas: todasLeccionesCompletadas,
      lecciones_completadas: leccionesCompletadasModulo,
      total_lecciones: totalLeccionesModulo,
    });
  } catch (error) {
    console.error('Error al marcar lección como completada:', error);
    return res.status(500).json({ message: 'Error al actualizar el progreso de la lección.' });
  }
}

/**
 * Marcar video general de un módulo como visto.
 */
async function marcarVideoVisto(req, res) {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;

    const modulo = await ModuloEducacion.findByPk(id, {
      include: [{ model: Examen, as: 'examen', where: { activo: true }, required: false }],
    });
    if (!modulo) {
      return res.status(404).json({ message: 'Módulo no encontrado.' });
    }

    let [progreso] = await ProgresoUsuarioModulo.findOrCreate({
      where: { usuario_id: usuarioId, modulo_id: modulo.id },
      defaults: {
        usuario_id: usuarioId,
        modulo_id: modulo.id,
        video_completado: true,
        completado: !modulo.examen,
        fecha_completado: !modulo.examen ? new Date() : null,
      },
    });

    if (!progreso.video_completado) {
      progreso.video_completado = true;
      if (!modulo.examen) {
        progreso.completado = true;
        progreso.fecha_completado = new Date();
      }
      await progreso.save();
    }

    return res.json({
      message: 'Video marcado como completado.',
      progreso,
    });
  } catch (error) {
    console.error('Error al marcar video como visto:', error);
    return res.status(500).json({ message: 'Error al registrar vista del video.' });
  }
}

/**
 * Enviar respuestas y calificar el examen del módulo.
 * Si el usuario falla 3 veces, el examen queda bloqueado por 4 horas.
 * NUNCA se devuelven las respuestas correctas ni explicaciones en caso de reprobación.
 */
async function enviarExamen(req, res) {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;
    const { respuestas = {} } = req.body;

    const modulo = await ModuloEducacion.findByPk(id, {
      include: [
        {
          model: Examen,
          as: 'examen',
          where: { activo: true },
          include: [{ model: PreguntaExamen, as: 'preguntas' }],
        },
      ],
    });

    if (!modulo || !modulo.examen) {
      return res.status(404).json({ message: 'No existe un examen activo para este módulo.' });
    }

    const preguntas = modulo.examen.preguntas || [];
    if (preguntas.length === 0) {
      return res.status(400).json({ message: 'El examen no tiene preguntas configuradas.' });
    }

    let [progreso] = await ProgresoUsuarioModulo.findOrCreate({
      where: { usuario_id: usuarioId, modulo_id: modulo.id },
      defaults: {
        usuario_id: usuarioId,
        modulo_id: modulo.id,
        video_completado: true,
        intentos: 0,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
      },
    });

    // 1. Verificar si el examen se encuentra actualmente bloqueado por penalización de 4 horas
    const ahora = new Date();
    if (progreso.bloqueado_hasta && ahora < new Date(progreso.bloqueado_hasta)) {
      const segundosRestantes = Math.max(1, Math.ceil((new Date(progreso.bloqueado_hasta).getTime() - ahora.getTime()) / 1000));
      const horas = Math.floor(segundosRestantes / 3600);
      const minutos = Math.ceil((segundosRestantes % 3600) / 60);
      const tiempoTexto = horas > 0 ? `${horas}h ${minutos}m` : `${minutos} minutos`;

      return res.status(403).json({
        message: `El examen se encuentra bloqueado temporalmente por 4 horas tras alcanzar 3 intentos fallidos. Podrás volver a intentarlo en ${tiempoTexto}. Te recomendamos repasar los videos.`,
        bloqueado: true,
        bloqueado_hasta: progreso.bloqueado_hasta,
        segundos_restantes: segundosRestantes,
        recomendacion: 'Aprovecha este tiempo para volver a ver las clases en video y repasar los conceptos.',
      });
    }

    // Si el bloqueo expiró, restablecer contador de fallos
    if (progreso.bloqueado_hasta && ahora >= new Date(progreso.bloqueado_hasta)) {
      progreso.bloqueado_hasta = null;
      progreso.intentos_fallidos = 0;
    }

    const parseOptions = (val) => {
      if (Array.isArray(val)) return val.map(v => String(v).trim().toUpperCase()).filter(Boolean).sort();
      if (typeof val === 'string') return val.split(',').map(v => v.trim().toUpperCase()).filter(Boolean).sort();
      if (val !== null && val !== undefined) return [String(val).trim().toUpperCase()];
      return [];
    };

    let correctas = 0;
    preguntas.forEach(p => {
      const arrUsuario = parseOptions(respuestas[p.id]);
      const arrCorrecta = parseOptions(p.respuesta_correcta);

      const esCorrecta = arrUsuario.length > 0 &&
        arrUsuario.length === arrCorrecta.length &&
        arrUsuario.every((val, idx) => val === arrCorrecta[idx]);

      if (esCorrecta) {
        correctas++;
      }
    });

    const puntaje = Math.round((correctas / preguntas.length) * 100);
    const aprobado = puntaje >= modulo.examen.puntaje_minimo;

    progreso.intentos = (progreso.intentos || 0) + 1;
    progreso.puntaje_obtenido = Math.max(progreso.puntaje_obtenido || 0, puntaje);

    let bloqueado = false;
    let segundosRestantes = 0;

    if (aprobado) {
      progreso.examen_aprobado = true;
      progreso.completado = true;
      progreso.fecha_completado = new Date();
      progreso.intentos_fallidos = 0;
      progreso.bloqueado_hasta = null;
    } else {
      // Incrementar contador de intentos fallidos
      progreso.intentos_fallidos = (progreso.intentos_fallidos || 0) + 1;
      
      // Si llega a 3 fallos seguidos, aplicar penalización de 4 horas
      if (progreso.intentos_fallidos >= 3) {
        bloqueado = true;
        const duracionBloqueoMs = 4 * 60 * 60 * 1000; // 4 horas
        progreso.bloqueado_hasta = new Date(Date.now() + duracionBloqueoMs);
        segundosRestantes = Math.ceil(duracionBloqueoMs / 1000);
      }
    }

    await progreso.save();

    // 🔒 IMPORTANTE: NUNCA se devuelven las respuestas correctas ni explicaciones
    return res.json({
      aprobado,
      puntaje,
      puntaje_minimo: modulo.examen.puntaje_minimo,
      correctas,
      total_preguntas: preguntas.length,
      intentos: progreso.intentos,
      intentos_fallidos: progreso.intentos_fallidos,
      intentos_restantes: Math.max(0, 3 - progreso.intentos_fallidos),
      bloqueado,
      bloqueado_hasta: progreso.bloqueado_hasta,
      segundos_restantes: segundosRestantes,
      completado: progreso.completado,
      menu_desbloqueado: aprobado ? modulo.menu_desbloqueado : null,
      recomendacion: aprobado 
        ? null 
        : 'Te sugerimos volver a mirar los videos de las clases para repasar los conceptos antes de volver a intentar la evaluación.',
    });
  } catch (error) {
    console.error('Error al calificar examen:', error);
    return res.status(500).json({ message: 'Error al procesar y calificar el examen.' });
  }
}

/**
 * Obtener estado de menús desbloqueados para alimentar la barra lateral del usuario
 */
async function getProgresoSidebar(req, res) {
  try {
    const usuarioId = req.usuario.id;

    // Obtener todos los módulos con menú configurado
    const modulos = await ModuloEducacion.findAll({
      where: { activo: true },
      order: [['orden', 'ASC'], ['id', 'ASC']],
      include: [
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
          required: false,
        },
      ],
    });

    const menusBloqueados = {};
    const menusDesbloqueados = new Set();

    modulos.forEach(m => {
      if (!m.menu_desbloqueado) return;

      const progreso = m.progresos && m.progresos.length > 0 ? m.progresos[0] : null;
      const estaAprobado = Boolean(progreso?.examen_aprobado);

      if (estaAprobado) {
        menusDesbloqueados.add(m.menu_desbloqueado);
      } else {
        menusBloqueados[m.menu_desbloqueado] = {
          modulo_id: m.id,
          modulo_titulo: m.titulo,
          orden: m.orden,
          icono: m.icono || '🎓',
        };
      }
    });

    // Eliminar de bloqueados los que ya están en desbloqueados
    menusDesbloqueados.forEach(m => {
      delete menusBloqueados[m];
    });

    const desbloqueadosArr = Array.from(menusDesbloqueados);
    return res.json({
      menus_desbloqueados: desbloqueadosArr,
      menusDesbloqueados: desbloqueadosArr,
      menus_bloqueados: menusBloqueados,
      menusBloqueados: menusBloqueados,
    });
  } catch (error) {
    console.error('Error al obtener progreso para sidebar:', error);
    return res.status(500).json({ message: 'Error al consultar permisos de menús de educación.' });
  }
}

module.exports = {
  getModulos,
  getDetalleModulo,
  marcarLeccionCompletada,
  marcarVideoVisto,
  enviarExamen,
  getProgresoSidebar,
};

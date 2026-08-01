const { ModuloEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo } = require('../models');

/**
 * Obtener listado de módulos con estado de progresión secuencial para el usuario autenticado
 */
async function getModulos(req, res) {
  try {
    const usuarioId = req.usuario.id;

    const modulos = await ModuloEducacion.findAll({
      where: { activo: true },
      order: [['orden', 'ASC']],
      include: [
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
          required: false,
        },
        {
          model: Examen,
          as: 'examen',
          where: { activo: true },
          required: false,
          attributes: ['id', 'titulo', 'puntaje_minimo'],
        },
      ],
    });

    let anteriorCompletado = true;
    const modulosConProgreso = modulos.map((m, idx) => {
      const progreso = m.progresos && m.progresos.length > 0 ? m.progresos[0] : null;
      const estaCompletado = Boolean(progreso?.completado);
      const estaDesbloqueado = idx === 0 || anteriorCompletado;

      anteriorCompletado = estaCompletado;

      return {
        id: m.id,
        titulo: m.titulo,
        descripcion: m.descripcion,
        orden: m.orden,
        video_url: m.video_url,
        duracion_minutos: m.duracion_minutos,
        menu_desbloqueado: m.menu_desbloqueado,
        desbloqueado: estaDesbloqueado,
        completado: estaCompletado,
        video_completado: Boolean(progreso?.video_completado),
        examen_aprobado: Boolean(progreso?.examen_aprobado),
        puntaje_obtenido: progreso?.puntaje_obtenido ?? null,
        intentos: progreso?.intentos || 0,
        tiene_examen: Boolean(m.examen),
      };
    });

    const totalModulos = modulosConProgreso.length;
    const completados = modulosConProgreso.filter(m => m.completado).length;
    const porcentajeProgreso = totalModulos > 0 ? Math.round((completados / totalModulos) * 100) : 0;

    return res.json({
      modulos: modulosConProgreso,
      resumen: {
        totalModulos,
        completados,
        porcentajeProgreso,
      },
    });
  } catch (error) {
    console.error('Error al obtener módulos de educación:', error);
    return res.status(500).json({ message: 'Error al cargar los módulos de educación.' });
  }
}

/**
 * Obtener detalle de un módulo con su examen y preguntas (sin revelar respuestas correctas)
 */
async function getDetalleModulo(req, res) {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;

    const modulo = await ModuloEducacion.findByPk(id, {
      include: [
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
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
              attributes: { exclude: ['respuesta_correcta'] }, // ⚠️ Ocultar respuestas correctas
            },
          ],
        },
      ],
    });

    if (!modulo || !modulo.activo) {
      return res.status(404).json({ message: 'Módulo no encontrado o inactivo.' });
    }

    const progreso = modulo.progresos && modulo.progresos.length > 0 ? modulo.progresos[0] : null;

    if (modulo.examen && modulo.examen.preguntas) {
      modulo.examen.preguntas.sort((a, b) => a.orden - b.orden);
    }

    return res.json({
      id: modulo.id,
      titulo: modulo.titulo,
      descripcion: modulo.descripcion,
      orden: modulo.orden,
      video_url: modulo.video_url,
      duracion_minutos: modulo.duracion_minutos,
      menu_desbloqueado: modulo.menu_desbloqueado,
      progreso: {
        video_completado: Boolean(progreso?.video_completado),
        examen_aprobado: Boolean(progreso?.examen_aprobado),
        puntaje_obtenido: progreso?.puntaje_obtenido ?? null,
        intentos: progreso?.intentos || 0,
        completado: Boolean(progreso?.completado),
        fecha_completado: progreso?.fecha_completado || null,
      },
      examen: modulo.examen || null,
    });
  } catch (error) {
    console.error('Error al obtener detalle del módulo:', error);
    return res.status(500).json({ message: 'Error al cargar el detalle del módulo.' });
  }
}

/**
 * Marcar video del módulo como visto
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
        intentos: 0,
      },
    });

    progreso.video_completado = true;

    // Si el módulo no tiene examen o ya fue aprobado, se marca completado el módulo
    if (!modulo.examen || progreso.examen_aprobado) {
      progreso.completado = true;
      progreso.fecha_completado = progreso.fecha_completado || new Date();
    }

    await progreso.save();

    return res.json({
      message: 'Video marcado como completado.',
      progreso: {
        video_completado: progreso.video_completado,
        examen_aprobado: progreso.examen_aprobado,
        completado: progreso.completado,
      },
    });
  } catch (error) {
    console.error('Error al marcar video como visto:', error);
    return res.status(500).json({ message: 'Error al actualizar progreso del video.' });
  }
}

/**
 * Enviar respuestas y calificar el examen del módulo
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

    let correctas = 0;
    const detalles = preguntas.map(p => {
      const respUsuario = respuestas[p.id] !== undefined ? String(respuestas[p.id]).trim().toLowerCase() : '';
      const respCorrecta = String(p.respuesta_correcta).trim().toLowerCase();
      const esCorrecta = respUsuario !== '' && respUsuario === respCorrecta;

      if (esCorrecta) {
        correctas++;
      }

      return {
        pregunta_id: p.id,
        pregunta: p.pregunta,
        es_correcta: esCorrecta,
        respuesta_usuario: respuestas[p.id] ?? null,
        respuesta_correcta: p.respuesta_correcta,
        explicacion: p.explicacion,
      };
    });

    const puntaje = Math.round((correctas / preguntas.length) * 100);
    const aprobado = puntaje >= modulo.examen.puntaje_minimo;

    let [progreso] = await ProgresoUsuarioModulo.findOrCreate({
      where: { usuario_id: usuarioId, modulo_id: modulo.id },
      defaults: {
        usuario_id: usuarioId,
        modulo_id: modulo.id,
        video_completado: true,
        intentos: 0,
      },
    });

    progreso.intentos = (progreso.intentos || 0) + 1;
    progreso.puntaje_obtenido = Math.max(progreso.puntaje_obtenido || 0, puntaje);
    if (aprobado) {
      progreso.examen_aprobado = true;
      progreso.completado = true;
      progreso.fecha_completado = new Date();
    }

    await progreso.save();

    return res.json({
      aprobado,
      puntaje,
      puntaje_minimo: modulo.examen.puntaje_minimo,
      correctas,
      total_preguntas: preguntas.length,
      detalles,
      completado: progreso.completado,
      menu_desbloqueado: aprobado ? modulo.menu_desbloqueado : null,
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

    const modulos = await ModuloEducacion.findAll({
      where: { activo: true },
      order: [['orden', 'ASC']],
      include: [
        {
          model: ProgresoUsuarioModulo,
          as: 'progresos',
          where: { usuario_id: usuarioId },
          required: false,
        },
      ],
    });

    const menusDesbloqueados = [];
    const menusBloqueados = [];

    modulos.forEach(m => {
      if (m.menu_desbloqueado) {
        const progreso = m.progresos && m.progresos.length > 0 ? m.progresos[0] : null;
        if (progreso && progreso.completado) {
          menusDesbloqueados.push(m.menu_desbloqueado);
        } else {
          menusBloqueados.push({
            menu: m.menu_desbloqueado,
            moduloId: m.id,
            moduloTitulo: m.titulo,
          });
        }
      }
    });

    const completados = modulos.filter(m => m.progresos?.[0]?.completado).length;

    return res.json({
      menusDesbloqueados,
      menusBloqueados,
      totalModulos: modulos.length,
      modulosCompletados: completados,
      todosCompletados: modulos.length > 0 && completados === modulos.length,
    });
  } catch (error) {
    console.error('Error al obtener progreso de sidebar:', error);
    return res.status(500).json({ message: 'Error al consultar estado del sidebar.' });
  }
}

module.exports = {
  getModulos,
  getDetalleModulo,
  marcarVideoVisto,
  enviarExamen,
  getProgresoSidebar,
};

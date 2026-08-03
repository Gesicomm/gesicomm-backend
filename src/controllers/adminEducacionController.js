const { ModuloEducacion, LeccionEducacion, Examen, PreguntaExamen, sequelize } = require('../models');

/**
 * Listar todos los módulos con sus lecciones multi-video, exámenes y métricas globales para el Studio LMS
 */
async function listModulos(req, res) {
  try {
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
              required: false,
            },
          ],
        },
      ],
    });

    let totalDuracionGlobal = 0;
    let totalPreguntasGlobal = 0;
    let totalLeccionesGlobal = 0;
    const menusSet = new Set();

    const modulosMapeados = modulos.map(m => {
      const lecciones = (m.lecciones || []).sort((a, b) => a.orden - b.orden);
      const duracionModulo = lecciones.reduce((acc, l) => acc + (l.duracion_min || 0), 0) || m.duracion_minutos || 0;
      const preguntas = (m.examen?.preguntas || []).sort((a, b) => a.orden - b.orden);

      totalDuracionGlobal += duracionModulo;
      totalPreguntasGlobal += preguntas.length;
      totalLeccionesGlobal += lecciones.length;
      if (m.menu_desbloqueado) menusSet.add(m.menu_desbloqueado);

      return {
        id: m.id,
        titulo: m.titulo,
        descripcion: m.descripcion,
        icono: m.icono || '🎓',
        color_accent: m.color_accent || '#3b82f6',
        estado: m.estado || 'publicado',
        orden: m.orden,
        duracion_minutos: duracionModulo,
        menu_desbloqueado: m.menu_desbloqueado,
        recursos_descarga: m.recursos_descarga || [],
        lecciones,
        total_lecciones: lecciones.length,
        examen: m.examen
          ? {
              id: m.examen.id,
              titulo: m.examen.titulo,
              descripcion: m.examen.descripcion,
              puntaje_minimo: m.examen.puntaje_minimo,
              total_preguntas: preguntas.length,
              preguntas,
            }
          : null,
      };
    });

    return res.json({
      modulos: modulosMapeados,
      metricas: {
        total_modulos: modulosMapeados.length,
        total_lecciones: totalLeccionesGlobal,
        total_duracion_minutos: totalDuracionGlobal,
        total_preguntas: totalPreguntasGlobal,
        menus_desbloqueables: menusSet.size,
      },
    });
  } catch (error) {
    console.error('Error al listar módulos en panel admin:', error);
    return res.status(500).json({ message: 'Error al obtener listado administrativo de módulos.' });
  }
}

/**
 * Crear un nuevo módulo con lecciones multi-video y examen completo
 */
async function createModulo(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const {
      titulo,
      descripcion,
      icono = '🎓',
      color_accent = '#3b82f6',
      estado = 'publicado',
      duracion_minutos,
      menu_desbloqueado,
      recursos_descarga = [],
      lecciones = [],
      examen,
    } = req.body;

    if (!titulo) {
      await transaction.rollback();
      return res.status(400).json({ message: 'El título del módulo es obligatorio.' });
    }

    // Calcular el orden automático al final de la ruta si no se especifica
    const maxOrden = await ModuloEducacion.max('orden') || 0;

    const nuevoModulo = await ModuloEducacion.create({
      titulo,
      descripcion,
      icono,
      color_accent,
      estado,
      orden: maxOrden + 1,
      duracion_minutos: duracion_minutos || 10,
      menu_desbloqueado: menu_desbloqueado || null,
      recursos_descarga: Array.isArray(recursos_descarga) ? recursos_descarga : [],
      activo: true,
    }, { transaction });

    // Guardar lecciones
    if (Array.isArray(lecciones) && lecciones.length > 0) {
      const leccionesToCreate = lecciones.map((lec, idx) => ({
        modulo_id: nuevoModulo.id,
        titulo: lec.titulo || `Clase ${idx + 1}`,
        descripcion: lec.descripcion || '',
        url_video: lec.url_video || '',
        duracion_min: Number(lec.duracion_min) || 5,
        orden: idx + 1,
        tipo: lec.tipo || 'video',
        recurso_url: lec.recurso_url || null,
        activo: true,
      }));
      await LeccionEducacion.bulkCreate(leccionesToCreate, { transaction });
    }

    // Guardar examen si está definido
    if (examen && (examen.preguntas?.length > 0 || examen.titulo)) {
      const nuevoExamen = await Examen.create({
        modulo_id: nuevoModulo.id,
        titulo: examen.titulo || `Evaluación: ${titulo}`,
        descripcion: examen.descripcion || '',
        puntaje_minimo: Number(examen.puntaje_minimo) || 80,
        activo: true,
      }, { transaction });

      if (Array.isArray(examen.preguntas) && examen.preguntas.length > 0) {
        const preguntasToCreate = examen.preguntas.map((p, idx) => ({
          examen_id: nuevoExamen.id,
          pregunta: p.pregunta,
          opciones: Array.isArray(p.opciones) ? p.opciones : [],
          respuesta_correcta: p.respuesta_correcta,
          explicacion: p.explicacion || '',
          orden: idx + 1,
        }));
        await PreguntaExamen.bulkCreate(preguntasToCreate, { transaction });
      }
    }

    await transaction.commit();

    return res.status(201).json({
      message: 'Módulo creado exitosamente en la ruta de aprendizaje.',
      modulo_id: nuevoModulo.id,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al crear módulo en admin:', error);
    return res.status(500).json({ message: 'Error interno al crear el módulo.' });
  }
}

/**
 * Actualizar módulo, sus lecciones multi-video y su examen de forma integral
 */
async function updateModulo(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const {
      titulo,
      descripcion,
      icono,
      color_accent,
      estado,
      duracion_minutos,
      menu_desbloqueado,
      recursos_descarga,
      lecciones,
      examen,
    } = req.body;

    const modulo = await ModuloEducacion.findByPk(id, { transaction });
    if (!modulo) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Módulo no encontrado.' });
    }

    if (titulo !== undefined) modulo.titulo = titulo;
    if (descripcion !== undefined) modulo.descripcion = descripcion;
    if (icono !== undefined) modulo.icono = icono;
    if (color_accent !== undefined) modulo.color_accent = color_accent;
    if (estado !== undefined) modulo.estado = estado;
    if (duracion_minutos !== undefined) modulo.duracion_minutos = duracion_minutos;
    if (menu_desbloqueado !== undefined) modulo.menu_desbloqueado = menu_desbloqueado || null;
    if (recursos_descarga !== undefined) modulo.recursos_descarga = recursos_descarga;

    await modulo.save({ transaction });

    // Actualizar lecciones si se enviaron
    if (Array.isArray(lecciones)) {
      await LeccionEducacion.destroy({ where: { modulo_id: modulo.id }, transaction });

      if (lecciones.length > 0) {
        const leccionesToCreate = lecciones.map((lec, idx) => ({
          modulo_id: modulo.id,
          titulo: lec.titulo || `Clase ${idx + 1}`,
          descripcion: lec.descripcion || '',
          url_video: lec.url_video || '',
          duracion_min: Number(lec.duracion_min) || 5,
          orden: idx + 1,
          tipo: lec.tipo || 'video',
          recurso_url: lec.recurso_url || null,
          activo: true,
        }));
        await LeccionEducacion.bulkCreate(leccionesToCreate, { transaction });
      }
    }

    // Actualizar examen
    if (examen !== undefined) {
      let examenDb = await Examen.findOne({ where: { modulo_id: modulo.id }, transaction });

      if (examen === null) {
        // Eliminar examen
        if (examenDb) {
          await PreguntaExamen.destroy({ where: { examen_id: examenDb.id }, transaction });
          await examenDb.destroy({ transaction });
        }
      } else {
        if (!examenDb) {
          examenDb = await Examen.create({
            modulo_id: modulo.id,
            titulo: examen.titulo || `Evaluación: ${modulo.titulo}`,
            descripcion: examen.descripcion || '',
            puntaje_minimo: Number(examen.puntaje_minimo) || 80,
            activo: true,
          }, { transaction });
        } else {
          examenDb.titulo = examen.titulo || examenDb.titulo;
          examenDb.descripcion = examen.descripcion !== undefined ? examen.descripcion : examenDb.descripcion;
          examenDb.puntaje_minimo = Number(examen.puntaje_minimo) || examenDb.puntaje_minimo;
          await examenDb.save({ transaction });
        }

        if (Array.isArray(examen.preguntas)) {
          await PreguntaExamen.destroy({ where: { examen_id: examenDb.id }, transaction });
          if (examen.preguntas.length > 0) {
            const preguntasToCreate = examen.preguntas.map((p, idx) => ({
              examen_id: examenDb.id,
              pregunta: p.pregunta,
              opciones: Array.isArray(p.opciones) ? p.opciones : [],
              respuesta_correcta: p.respuesta_correcta,
              explicacion: p.explicacion || '',
              orden: idx + 1,
            }));
            await PreguntaExamen.bulkCreate(preguntasToCreate, { transaction });
          }
        }
      }
    }

    await transaction.commit();

    return res.json({
      message: 'Módulo y lecciones actualizados exitosamente.',
      modulo_id: modulo.id,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al actualizar módulo en admin:', error);
    return res.status(500).json({ message: 'Error interno al actualizar el módulo.' });
  }
}

/**
 * Reordenar los módulos según el orden de la ruta en Drag & Drop
 */
async function reordenarModulos(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const { modulosOrdenados } = req.body; // Array de IDs ordenados: [3, 1, 2]

    if (!Array.isArray(modulosOrdenados)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Se esperaba un arreglo de IDs ordenados.' });
    }

    for (let index = 0; index < modulosOrdenados.length; index++) {
      const id = modulosOrdenados[index];
      await ModuloEducacion.update(
        { orden: index + 1 },
        { where: { id }, transaction }
      );
    }

    await transaction.commit();
    return res.json({ success: true, message: 'Ruta reordenada con éxito.' });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al reordenar módulos:', error);
    return res.status(500).json({ message: 'Error interno al reordenar la ruta de módulos.' });
  }
}

/**
 * Duplicar un módulo con todas sus lecciones y examen
 */
async function duplicarModulo(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;

    const original = await ModuloEducacion.findByPk(id, {
      include: [
        { model: LeccionEducacion, as: 'lecciones' },
        {
          model: Examen,
          as: 'examen',
          include: [{ model: PreguntaExamen, as: 'preguntas' }],
        },
      ],
      transaction,
    });

    if (!original) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Módulo original no encontrado.' });
    }

    const maxOrden = (await ModuloEducacion.max('orden', { transaction })) || 0;

    const duplicado = await ModuloEducacion.create({
      titulo: `${original.titulo} (Copia)`,
      descripcion: original.descripcion,
      icono: original.icono,
      color_accent: original.color_accent,
      estado: 'borrador',
      orden: maxOrden + 1,
      duracion_minutos: original.duracion_minutos,
      menu_desbloqueado: null,
      recursos_descarga: original.recursos_descarga || [],
      activo: true,
    }, { transaction });

    if (original.lecciones && original.lecciones.length > 0) {
      const leccionesClon = original.lecciones.map(l => ({
        modulo_id: duplicado.id,
        titulo: l.titulo,
        descripcion: l.descripcion,
        url_video: l.url_video,
        duracion_min: l.duracion_min,
        orden: l.orden,
        tipo: l.tipo,
        recurso_url: l.recurso_url,
        activo: true,
      }));
      await LeccionEducacion.bulkCreate(leccionesClon, { transaction });
    }

    if (original.examen) {
      const examenClon = await Examen.create({
        modulo_id: duplicado.id,
        titulo: original.examen.titulo,
        descripcion: original.examen.descripcion,
        puntaje_minimo: original.examen.puntaje_minimo,
        activo: true,
      }, { transaction });

      if (original.examen.preguntas && original.examen.preguntas.length > 0) {
        const preguntasClon = original.examen.preguntas.map(p => ({
          examen_id: examenClon.id,
          pregunta: p.pregunta,
          opciones: p.opciones,
          respuesta_correcta: p.respuesta_correcta,
          explicacion: p.explicacion,
          orden: p.orden,
        }));
        await PreguntaExamen.bulkCreate(preguntasClon, { transaction });
      }
    }

    await transaction.commit();
    return res.status(201).json({
      message: 'Módulo duplicado con éxito.',
      modulo_id: duplicado.id,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al duplicar módulo:', error);
    return res.status(500).json({ message: 'Error interno al duplicar el módulo.' });
  }
}

/**
 * Eliminar (soft delete) módulo y sus dependencias
 */
async function deleteModulo(req, res) {
  try {
    const { id } = req.params;
    const modulo = await ModuloEducacion.findByPk(id);

    if (!modulo) {
      return res.status(404).json({ message: 'Módulo no encontrado.' });
    }

    modulo.activo = false;
    await modulo.save();

    return res.json({ message: 'Módulo eliminado con éxito de la ruta.' });
  } catch (error) {
    console.error('Error al eliminar módulo:', error);
    return res.status(500).json({ message: 'Error interno al eliminar el módulo.' });
  }
}

module.exports = {
  listModulos,
  createModulo,
  updateModulo,
  reordenarModulos,
  duplicarModulo,
  deleteModulo,
};

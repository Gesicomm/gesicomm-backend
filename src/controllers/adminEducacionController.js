const { ModuloEducacion, Examen, PreguntaExamen, sequelize } = require('../models');

/**
 * Listar todos los módulos para administración
 */
async function listModulos(req, res) {
  try {
    const modulos = await ModuloEducacion.findAll({
      order: [['orden', 'ASC']],
      include: [
        {
          model: Examen,
          as: 'examen',
          include: [{ model: PreguntaExamen, as: 'preguntas' }],
        },
      ],
    });

    return res.json({ modulos });
  } catch (error) {
    console.error('Error al listar módulos (admin):', error);
    return res.status(500).json({ message: 'Error al obtener listado de módulos.' });
  }
}

/**
 * Crear un nuevo módulo con su examen y preguntas asociadas
 */
async function createModulo(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const {
      titulo,
      descripcion,
      orden = 1,
      video_url,
      duracion_minutos,
      menu_desbloqueado,
      activo = true,
      examen,
    } = req.body;

    const inquilinoId = req.usuario?.tenantId || req.usuario?.inquilino_id || null;

    if (!titulo || !video_url) {
      await transaction.rollback();
      return res.status(400).json({ message: 'El título y la URL del video son obligatorios.' });
    }

    const nuevoModulo = await ModuloEducacion.create(
      {
        inquilino_id: inquilinoId,
        titulo,
        descripcion,
        orden: Number(orden) || 1,
        video_url,
        duracion_minutos: duracion_minutos ? Number(duracion_minutos) : null,
        menu_desbloqueado: menu_desbloqueado || null,
        activo: Boolean(activo),
      },
      { transaction }
    );

    if (examen && examen.titulo) {
      const nuevoExamen = await Examen.create(
        {
          modulo_id: nuevoModulo.id,
          titulo: examen.titulo,
          descripcion: examen.descripcion || '',
          puntaje_minimo: Number(examen.puntaje_minimo) || 70,
          activo: examen.activo !== false,
        },
        { transaction }
      );

      if (Array.isArray(examen.preguntas) && examen.preguntas.length > 0) {
        const preguntasParaCrear = examen.preguntas.map((p, idx) => ({
          examen_id: nuevoExamen.id,
          pregunta: p.pregunta,
          tipo: p.tipo || 'opcion_multiple',
          opciones: p.opciones || [],
          respuesta_correcta: String(p.respuesta_correcta),
          explicacion: p.explicacion || '',
          orden: Number(p.orden) || (idx + 1),
        }));

        await PreguntaExamen.bulkCreate(preguntasParaCrear, { transaction });
      }
    }

    await transaction.commit();

    const moduloCompleto = await ModuloEducacion.findByPk(nuevoModulo.id, {
      include: [
        {
          model: Examen,
          as: 'examen',
          include: [{ model: PreguntaExamen, as: 'preguntas' }],
        },
      ],
    });

    return res.status(201).json({
      message: 'Módulo creado exitosamente.',
      modulo: moduloCompleto,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al crear módulo (admin):', error);
    return res.status(500).json({ message: 'Error al crear el módulo de educación.' });
  }
}

/**
 * Actualizar módulo existente y su examen
 */
async function updateModulo(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const {
      titulo,
      descripcion,
      orden,
      video_url,
      duracion_minutos,
      menu_desbloqueado,
      activo,
      examen,
    } = req.body;

    const modulo = await ModuloEducacion.findByPk(id);
    if (!modulo) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Módulo no encontrado.' });
    }

    await modulo.update(
      {
        titulo: titulo !== undefined ? titulo : modulo.titulo,
        descripcion: descripcion !== undefined ? descripcion : modulo.descripcion,
        orden: orden !== undefined ? Number(orden) : modulo.orden,
        video_url: video_url !== undefined ? video_url : modulo.video_url,
        duracion_minutos: duracion_minutos !== undefined ? (duracion_minutos ? Number(duracion_minutos) : null) : modulo.duracion_minutos,
        menu_desbloqueado: menu_desbloqueado !== undefined ? menu_desbloqueado : modulo.menu_desbloqueado,
        activo: activo !== undefined ? Boolean(activo) : modulo.activo,
      },
      { transaction }
    );

    if (examen) {
      let examenExistente = await Examen.findOne({
        where: { modulo_id: modulo.id },
        transaction,
      });

      if (examenExistente) {
        await examenExistente.update(
          {
            titulo: examen.titulo || examenExistente.titulo,
            descripcion: examen.descripcion !== undefined ? examen.descripcion : examenExistente.descripcion,
            puntaje_minimo: examen.puntaje_minimo !== undefined ? Number(examen.puntaje_minimo) : examenExistente.puntaje_minimo,
            activo: examen.activo !== undefined ? Boolean(examen.activo) : examenExistente.activo,
          },
          { transaction }
        );

        if (Array.isArray(examen.preguntas)) {
          await PreguntaExamen.destroy({ where: { examen_id: examenExistente.id }, transaction });

          if (examen.preguntas.length > 0) {
            const preguntasParaCrear = examen.preguntas.map((p, idx) => ({
              examen_id: examenExistente.id,
              pregunta: p.pregunta,
              tipo: p.tipo || 'opcion_multiple',
              opciones: p.opciones || [],
              respuesta_correcta: String(p.respuesta_correcta),
              explicacion: p.explicacion || '',
              orden: Number(p.orden) || (idx + 1),
            }));
            await PreguntaExamen.bulkCreate(preguntasParaCrear, { transaction });
          }
        }
      } else if (examen.titulo) {
        const nuevoExamen = await Examen.create(
          {
            modulo_id: modulo.id,
            titulo: examen.titulo,
            descripcion: examen.descripcion || '',
            puntaje_minimo: Number(examen.puntaje_minimo) || 70,
            activo: examen.activo !== false,
          },
          { transaction }
        );

        if (Array.isArray(examen.preguntas) && examen.preguntas.length > 0) {
          const preguntasParaCrear = examen.preguntas.map((p, idx) => ({
            examen_id: nuevoExamen.id,
            pregunta: p.pregunta,
            tipo: p.tipo || 'opcion_multiple',
            opciones: p.opciones || [],
            respuesta_correcta: String(p.respuesta_correcta),
            explicacion: p.explicacion || '',
            orden: Number(p.orden) || (idx + 1),
          }));
          await PreguntaExamen.bulkCreate(preguntasParaCrear, { transaction });
        }
      }
    }

    await transaction.commit();

    const moduloActualizado = await ModuloEducacion.findByPk(modulo.id, {
      include: [
        {
          model: Examen,
          as: 'examen',
          include: [{ model: PreguntaExamen, as: 'preguntas' }],
        },
      ],
    });

    return res.json({
      message: 'Módulo actualizado correctamente.',
      modulo: moduloActualizado,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error al actualizar módulo (admin):', error);
    return res.status(500).json({ message: 'Error al actualizar el módulo.' });
  }
}

/**
 * Eliminar módulo (elimina en cascada su examen, preguntas y progresos)
 */
async function deleteModulo(req, res) {
  try {
    const { id } = req.params;
    const modulo = await ModuloEducacion.findByPk(id);

    if (!modulo) {
      return res.status(404).json({ message: 'Módulo no encontrado.' });
    }

    await modulo.destroy();

    return res.json({ message: 'Módulo eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar módulo (admin):', error);
    return res.status(500).json({ message: 'Error al eliminar el módulo.' });
  }
}

module.exports = {
  listModulos,
  createModulo,
  updateModulo,
  deleteModulo,
};

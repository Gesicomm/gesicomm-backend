const AfiliadosService = require('../services/afiliados.service');

function baseUrl(req) {
  const origen = req.get('origin');
  return origen || process.env.FRONTEND_URL || 'https://gesicomm.com';
}

exports.listar = async (req, res) => {
  try {
    res.json(await AfiliadosService.listar({ baseUrl: baseUrl(req) }));
  } catch (error) {
    console.error('[Afiliados] listar:', error);
    res.status(500).json({ message: 'No se pudieron cargar los afiliados.' });
  }
};

exports.crear = async (req, res) => {
  try {
    res.status(201).json(await AfiliadosService.crear(req.body || {}, { baseUrl: baseUrl(req) }));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'No se pudo crear el afiliado.' });
  }
};

exports.actualizar = async (req, res) => {
  try {
    res.json(await AfiliadosService.actualizar(req.params.id, req.body || {}, { baseUrl: baseUrl(req) }));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'No se pudo actualizar el afiliado.' });
  }
};

exports.eliminar = async (req, res) => {
  try {
    await AfiliadosService.eliminar(req.params.id);
    res.json({ message: 'Afiliado eliminado.' });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'No se pudo eliminar el afiliado.' });
  }
};

exports.registrarClick = async (req, res) => {
  try {
    const afiliado = await AfiliadosService.registrarClick({
      codigo: req.body?.codigo,
      landingUrl: req.body?.landing_url,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    if (!afiliado) return res.status(404).json({ message: 'Código de afiliado inválido.' });
    res.json({ afiliado: { codigo: afiliado.codigo, nombre: afiliado.nombre } });
  } catch (error) {
    console.error('[Afiliados] click:', error);
    res.status(500).json({ message: 'No se pudo registrar el referido.' });
  }
};

exports.listarComisiones = async (req, res) => {
  try {
    res.json(await AfiliadosService.listarComisiones());
  } catch (error) {
    console.error('[Afiliados] comisiones:', error);
    res.status(500).json({ message: 'No se pudieron cargar las comisiones.' });
  }
};

exports.actualizarComision = async (req, res) => {
  try {
    res.json(await AfiliadosService.actualizarComision(req.params.id, req.body || {}));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || 'No se pudo actualizar la comisión.' });
  }
};

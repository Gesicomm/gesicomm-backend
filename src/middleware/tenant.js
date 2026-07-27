/**
 * Middleware de aislamiento Multi-Tenant.
 *
 * 🔥 Este es el middleware de seguridad más crítico de Gesicomm.
 *
 * Garantiza que un usuario de Tenant A JAMÁS pueda acceder a datos del Tenant B.
 *
 * El tenantId SIEMPRE viene del JWT firmado por el servidor.
 * NUNCA del body, query o params enviados por el cliente.
 *
 * ❌ MAL:
 *   const { tenantId } = req.body; // Un usuario puede falsificar esto
 *   SELECT * FROM pedidos WHERE id = $1 AND tenant_id = $2
 *
 * ✅ BIEN:
 *   const tenantId = req.usuario.tenantId; // Del JWT verificado por el servidor
 *   SELECT * FROM pedidos WHERE id = $1 AND tenant_id = $2
 *
 * Uso:
 *   router.get('/pedidos', verificarToken, aislarTenant, listarPedidos);
 *
 *   // En el controlador:
 *   const tenantId = req.tenantId; // Siempre seguro
 */
function aislarTenant(req, res, next) {
  const tenantId = req.usuario?.tenantId;

  if (!tenantId) {
    return res.status(403).json({ message: 'Tenant no identificado.' });
  }

  // Exponemos el tenantId de manera segura para los controladores
  req.tenantId = tenantId;

  next();
}

module.exports = { aislarTenant };

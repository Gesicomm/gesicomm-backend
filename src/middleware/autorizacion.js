/**
 * Middleware de Autorización (RBAC — Control de Acceso Basado en Roles).
 *
 * Autenticación ≠ Autorización:
 *   - Autenticación: ¿Quién eres?     → verificarToken()
 *   - Autorización:  ¿Puedes hacer esto? → verificarRol()
 *
 * Jerarquía de roles en Gesicomm:
 *
 *   SUPER_ADMIN  → Acceso total al sistema (gestión de tenants)
 *   TENANT_ADMIN → Administrador del tenant (su empresa)
 *   MANAGER      → Puede gestionar productos, pedidos, clientes
 *   SELLER       → Solo puede ver y crear pedidos
 *
 * Uso:
 *   router.delete('/usuarios/:id',
 *     verificarToken,
 *     verificarRol(['SUPER_ADMIN', 'TENANT_ADMIN']),
 *     eliminarUsuario
 *   );
 */

const ROLES = {
  SUPER_ADMIN: 4,
  TENANT_ADMIN: 3,
  MANAGER: 2,
  SELLER: 1,
};

/**
 * Verifica que el usuario tenga al menos uno de los roles requeridos.
 * @param {string[]} rolesPermitidos - Lista de roles con acceso al endpoint.
 */
function verificarRol(rolesPermitidos = []) {
  return (req, res, next) => {
    const rolUsuario = req.usuario?.rol;

    if (!rolUsuario || !rolesPermitidos.includes(rolUsuario)) {
      return res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });
    }

    next();
  };
}

module.exports = { verificarRol, ROLES };

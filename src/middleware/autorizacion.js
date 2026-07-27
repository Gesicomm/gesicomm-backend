/**
 * Middleware de Autorización (RBAC dinámico por base de datos).
 *
 * El modelo Rol contiene un JSON 'permisos' con un arreglo de acciones permitidas.
 * Ej: ["ver_usuarios", "crear_productos"]
 *
 * Uso:
 *   router.post('/productos',
 *     verificarToken,
 *     verificarPermiso('crear_productos'),
 *     crearProducto
 *   );
 */

/**
 * Verifica que el usuario tenga el permiso requerido en su rol.
 * @param {string} permisoRequerido - El string exacto del permiso.
 */
function verificarPermiso(permisoRequerido) {
  return (req, res, next) => {
    // Los permisos ahora vendrán inyectados en el token JWT o los podemos buscar en middleware
    const permisosUsuario = req.usuario?.permisos || [];

    if (!permisosUsuario.includes(permisoRequerido)) {
      return res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });
    }

    next();
  };
}

module.exports = { verificarPermiso };

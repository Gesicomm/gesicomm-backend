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
    const rol = req.usuario?.rol;
    
    if (rol === 'administrador') {
      return next();
    }
    if (rol === 'usuario' || rol === 'solo_pedidos') {
      const permisosDinamicos = [
        'ver_productos', 'crear_productos', 'editar_productos', 'eliminar_productos',
        'ver_combos', 'crear_combos', 'editar_combos', 'activar_combos', 'configurar_combos'
      ];
      if (permisosDinamicos.includes(permisoRequerido)) {
        return next();
      }
    }

    // Los permisos ahora vendrán inyectados en el token JWT o los podemos buscar en middleware
    const permisosUsuario = req.usuario?.permisos || [];

    if (!permisosUsuario.includes(permisoRequerido)) {
      return res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });
    }

    next();
  };
}

module.exports = { verificarPermiso };

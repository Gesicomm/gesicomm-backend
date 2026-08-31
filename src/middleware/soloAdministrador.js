'use strict';

/**
 * Restringe una ruta al rol 'administrador' y a nadie más.
 *
 * No alcanza con verificarPermiso() para esto: ese middleware deja pasar
 * al administrador PERO TAMBIÉN a cualquier usuario que tenga el permiso
 * en su rol. Acá lo que se quiere es lo contrario — que por ahora el
 * módulo sea exclusivo del admin aunque el permiso exista.
 *
 * Uso (ver routes/pageBuilder.js):
 *
 *   router.use(verificarToken);
 *   router.use(soloAdministrador);                        // ← hoy
 *   // router.use(verificarPermiso('gestionar_paginas')); // ← el día que se libere
 *
 * Cuando el Page Builder se abra a los usuarios, se cambia una línea: se
 * saca este middleware y se descomenta el de permisos. El permiso
 * 'gestionar_paginas' ya existe en scripts/seed-permissions.js justamente
 * para que ese día no haya que tocar nada más.
 *
 * Va SIEMPRE después de verificarToken: sin req.usuario no hay rol que mirar.
 */
function soloAdministrador(req, res, next) {
  if (req.usuario?.rol === 'administrador') {
    return next();
  }

  return res.status(403).json({
    message: 'Esta sección todavía está disponible solo para administradores.',
  });
}

module.exports = { soloAdministrador };

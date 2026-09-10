/**
 * Middleware de validación de inputs con Zod.
 *
 * NUNCA confiar en req.body, req.params, req.query sin validar.
 * Todo input externo debe rechazarse si no cumple el esquema esperado.
 *
 * Ejemplo de uso:
 *   const { z } = require('zod');
 *   const esquemaLogin = z.object({
 *     email: z.string().email(),
 *     password: z.string().min(8),
 *   });
 *
 *   router.post('/login', validar(esquemaLogin), loginController);
 */
const { z } = require('zod');

/**
 * Valida req.body contra un esquema de Zod.
 * Si falla, responde 400 con los errores de validación.
 * @param {z.ZodSchema} esquema - Esquema de Zod para validar el body.
 */
function validar(esquema) {
  return (req, res, next) => {
    const resultado = esquema.safeParse(req.body);

    if (!resultado.success) {
      const errores = resultado.error.errors.map((e) => ({
        campo: e.path.join('.'),
        mensaje: e.message,
      }));

      return res.status(400).json({
        message: 'Datos de entrada inválidos.',
        errores,
      });
    }

    // Reemplazamos req.body con los datos validados y parseados por Zod
    req.body = resultado.data;
    next();
  };
}

// ============================================================
// Esquemas de validación reutilizables
// ============================================================

const esquemaLogin = z.object({
  email: z.string().email({ message: 'Email inválido.' }),
  password: z.string().min(8, { message: 'La contraseña debe tener al menos 8 caracteres.' }),
});

const esquemaRegistro = z.object({
  nombre: z.string().min(2, { message: 'El nombre es requerido.' }),
  email: z.string().email({ message: 'Email inválido.' }),
  password: z
    .string()
    .min(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
    .regex(/[A-Z]/, { message: 'La contraseña debe tener al menos una mayúscula.' })
    .regex(/[0-9]/, { message: 'La contraseña debe tener al menos un número.' }),
  // Alta con plan pago: token de un solo uso emitido cuando PagoPar acredita
  // el cobro. Opcional — sin él, el alta funciona como siempre. Tiene que
  // estar declarado acá o Zod lo descarta (validar() reemplaza req.body por
  // resultado.data, que solo trae las claves del esquema).
  token_suscripcion: z.string().length(64).optional(),
});

const esquemaRecuperarPassword = z.object({
  email: z.string().email({ message: 'Email inválido.' }),
});

const esquemaResetPassword = z.object({
  token: z.string().min(32, { message: 'El enlace de recuperación no es válido.' }),
  password: z
    .string()
    .min(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
    .regex(/[A-Z]/, { message: 'La contraseña debe tener al menos una mayúscula.' })
    .regex(/[0-9]/, { message: 'La contraseña debe tener al menos un número.' }),
});

module.exports = {
  validar,
  esquemaLogin,
  esquemaRegistro,
  esquemaRecuperarPassword,
  esquemaResetPassword,
};

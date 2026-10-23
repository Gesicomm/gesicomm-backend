# Códigos de prueba de Gesicom

El administrador los gestiona desde **Solicitudes de la web → Códigos de prueba
gratuita**. Elige un plan activo y de 1 a 365 días. No hay duración predeterminada.
Puede restringir el destinatario por correo, limitar la fecha de canje y
desactivar códigos pendientes. La fecha límite de canje es independiente del
período de acceso.

Cada código tiene un único uso. El usuario lo ingresa en `/registro`, en el
campo opcional Código de prueba. La duración empieza en el registro; se conserva
la verificación obligatoria del correo. No se puede combinar con un token de
suscripción pagada en la misma alta. La suscripción resultante cuesta cero,
contiene un período de inicio y fin y usa la comprobación de vigencia existente.

El canje bloquea la fila con `FOR UPDATE` dentro de la transacción de registro.
Usuario, código y suscripción se confirman juntos o se revierten juntos. No se
generan pagos ni comisiones de afiliados. Desactivar un código ya canjeado no
revoca una prueba en curso.

La migración `20261023090000-codigos-prueba.js` crea únicamente la tabla de
códigos, con IDs enteros, referencias y una restricción de duración. Fue aplicada
el 23/10/2026 en la base configurada del workspace. Al desplegar en otra base,
ejecutar las migraciones antes de activar este código.

La landing solicita una prueba sin prometer días. El asunto actual es
«Gesicom · Código de prueba gratuita»; la bandeja reconoce también solicitudes
anteriores que mencionaban un cupón de siete días.

Validación: tests de servicio, registro HTTP, autorización de administrador,
recorridos de navegador en celular/escritorio y canjes reales de 14/20 días en
PostgreSQL con rollback de todos los datos de prueba. La suite previa
`services/suscripcionFlujo.test.js` presenta dos fallos de fixtures de checkout
sin nombre/teléfono válidos; ni ese archivo ni `suscripcion.service.js` fueron
modificados por este cambio.

jest.mock('../services/notificaciones/emailTransport.service',()=>({enviarEmail:jest.fn()}));
const EmailTransport=require('../services/notificaciones/emailTransport.service');
const {construirBienvenidaEquipo,enviarBienvenidaEquipo}=require('../services/notificaciones/accesoEquipo.service');
const datos={nombre:'Ana Benítez',email:'ana@example.com',password:'Clave<Segura>1',tienda:'Moda <Luque>',invitante:'Martín',permisos:{productos:'gestionar',clientes:'ver'}};
beforeEach(()=>{jest.clearAllMocks();process.env.FRONTEND_URL='https://gesicomm.com/';});
test('arma asunto, enlace de ingreso y permisos legibles',()=>{
 const {subject,html,text,urlLogin}=construirBienvenidaEquipo(datos);
 expect(urlLogin).toBe('https://gesicomm.com/login');
 expect(subject).toBe('Martín te sumó al equipo de Moda <Luque> en Gesicom');
 expect(html).toContain('href="https://gesicomm.com/login"');
 expect(html).toContain('Hola, Ana.');
 expect(html).toContain('Moda &lt;Luque&gt;');expect(html).not.toContain('Moda <Luque>');
 expect(html).toContain('Ver y gestionar');expect(html).toContain('Solo ver');
 expect(html).toContain('Clave&lt;Segura&gt;1');
 expect(text).toContain('Usuario: ana@example.com');expect(text).toContain('Contraseña: Clave<Segura>1');
 expect(text).toContain('Iniciar sesión: https://gesicomm.com/login');
 expect(text).toContain('Productos: ver y gestionar');
});
test('envía por el transporte configurado (Brevo) al correo de la persona',async()=>{
 EmailTransport.enviarEmail.mockResolvedValue({enviado:true});
 await expect(enviarBienvenidaEquipo(datos)).resolves.toEqual({enviado:true});
 expect(EmailTransport.enviarEmail).toHaveBeenCalledWith(expect.objectContaining({to:'ana@example.com'}));
});
test('un error del proveedor no se propaga',async()=>{
 EmailTransport.enviarEmail.mockRejectedValue(new Error('caído'));
 await expect(enviarBienvenidaEquipo(datos)).resolves.toEqual({enviado:false});
});

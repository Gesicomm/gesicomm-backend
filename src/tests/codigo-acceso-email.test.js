jest.mock('../services/notificaciones/emailTransport.service',()=>({enviarEmailUnaVez:jest.fn()}));
const Transport=require('../services/notificaciones/emailTransport.service');
const {construirCodigoAcceso,enviarCodigoAcceso}=require('../services/notificaciones/codigoAcceso.service');
const codigo={id:12,codigo:'GESI-ABC123',email:'ana@example.test',dias:14,ruta_acceso:'personal',vence_en:'2030-01-20T12:00:00Z'};
beforeEach(()=>{jest.clearAllMocks();process.env.FRONTEND_URL='https://gesicomm.com/';});
test('envía acceso, duración exacta, destinatario y condiciones de uso con HTML seguro',()=>{
  const correo=construirCodigoAcceso(codigo,{nombre:'Plan <especial>'});
  expect(correo.to).toBe(codigo.email);
  expect(correo.text).toContain(codigo.codigo);
  expect(correo.text).toContain('14 días');
  expect(correo.text).toContain('Marca personal');
  expect(correo.text).toContain('No lo compartas');
  expect(correo.text).toContain('al crear la cuenta');
  expect(correo.text).toContain('vence automáticamente');
  expect(correo.text).toContain('hora de Paraguay');
  expect(correo.html).toContain('Plan &lt;especial&gt;');
  expect(correo.html).not.toContain('Plan <especial>');
  expect(correo.html).toContain('href="https://gesicomm.com/registro"');
});
test('usa el transporte existente de Brevo con una clave de envío estable por código',async()=>{
  Transport.enviarEmailUnaVez.mockResolvedValue({enviado:true});
  expect(await enviarCodigoAcceso(codigo,{nombre:'Prueba'})).toEqual({emailEnviado:true,correoEstado:'enviado'});
  expect(Transport.enviarEmailUnaVez).toHaveBeenCalledWith(expect.objectContaining({to:codigo.email,eventKey:'codigo-acceso:12',tipo:'codigo_acceso'}));
});
test('un correo ya enviado conserva la confirmación sin generar un envío nuevo',async()=>{
  Transport.enviarEmailUnaVez.mockResolvedValue({enviado:false,omitido:true,evento:{estado:'sent'}});
  expect(await enviarCodigoAcceso(codigo,{nombre:'Prueba'})).toMatchObject({emailEnviado:true});
});
test('sin destinatario no llama al proveedor',async()=>{
  expect(await enviarCodigoAcceso({...codigo,email:null},{})).toMatchObject({correoEstado:'sin-destinatario'});
  expect(Transport.enviarEmailUnaVez).not.toHaveBeenCalled();
});
test('un fallo del proveedor no se propaga al alta del código',async()=>{
  Transport.enviarEmailUnaVez.mockRejectedValue(new Error('offline'));
  expect(await enviarCodigoAcceso(codigo,{})).toEqual({emailEnviado:false,correoEstado:'fallido'});
});

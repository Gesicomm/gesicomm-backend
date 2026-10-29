jest.mock('../models',()=>({NotificationEvent:{findOrCreate:jest.fn()}}));
jest.mock('@getbrevo/brevo',()=>({BrevoClient:jest.fn().mockImplementation(()=>({transactionalEmails:{sendTransacEmail:jest.fn()}}))}));
const {NotificationEvent}=require('../models');
const {BrevoClient}=require('@getbrevo/brevo');
const {enviarCodigoAcceso}=require('../services/notificaciones/codigoAcceso.service');

test('el flujo completo usa Brevo, reintenta el mismo código ante un fallo y omite duplicados confirmados',async()=>{
 process.env.EMAIL_PROVIDER='brevo';process.env.BREVO_API_KEY='fake-local-test-key';process.env.BREVO_FROM_EMAIL='test@example.test';
 const evento={estado:'pending',attempts:0,update:jest.fn(async changes=>Object.assign(evento,changes))};
 NotificationEvent.findOrCreate.mockResolvedValueOnce([evento,true]).mockResolvedValue([evento,false]);
 const codigo={id:70,codigo:'GESI-TEST1234',email:'ana@example.test',dias:20,ruta_acceso:'fisico'};
 // El primer intento falla en el proveedor, sin tocar códigos ni suscripciones.
 BrevoClient.mockImplementationOnce(()=>({transactionalEmails:{sendTransacEmail:jest.fn().mockRejectedValueOnce(new Error('provider offline')).mockResolvedValue({messageId:'test-message'})}}));
 expect(await enviarCodigoAcceso(codigo,{nombre:'Una ruta'})).toMatchObject({emailEnviado:false});
 expect(evento.estado).toBe('failed');
 expect(await enviarCodigoAcceso(codigo,{nombre:'Una ruta'})).toMatchObject({emailEnviado:true});
 expect(evento.estado).toBe('sent');
 expect(await enviarCodigoAcceso(codigo,{nombre:'Una ruta'})).toMatchObject({emailEnviado:true});
 const sdk=BrevoClient.mock.results[0].value.transactionalEmails.sendTransacEmail;
 expect(sdk).toHaveBeenCalledTimes(2);
 expect(sdk).toHaveBeenLastCalledWith(expect.objectContaining({to:[{email:'ana@example.test'}],sender:expect.objectContaining({email:'test@example.test'}),textContent:expect.stringContaining('20 días'),htmlContent:expect.stringContaining(codigo.codigo)}));
 expect(evento.attempts).toBe(2);
});

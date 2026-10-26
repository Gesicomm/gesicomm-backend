const {suscribir}=require('../services/marcaPersonalWhatsapp.subscription');
beforeEach(()=>{process.env.FACEBOOK_APP_ID='app-gesicom';process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN='private-test';});
afterEach(()=>{delete process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN;});
test('no considera suficiente la app interna de Meta: registra y comprueba la app de Gesicom',async()=>{
 const graph={facebook:jest.fn().mockResolvedValueOnce({success:true}).mockResolvedValueOnce({data:[{whatsapp_business_api_data:{id:'meta-interna'}},{whatsapp_business_api_data:{id:'app-gesicom'}}]})};
 expect(await suscribir({graph,cuenta:'123',token:'private-token'})).toEqual({ok:true});
 expect(graph.facebook.mock.calls).toEqual([['123/subscribed_apps',{method:'POST',token:'private-token'}],['123/subscribed_apps',{token:'private-token'}]]);
});
test('un POST aceptado sin la app propia sigue siendo un error, nunca declara activa la recepción',async()=>{
 const graph={facebook:jest.fn().mockResolvedValueOnce({success:true}).mockResolvedValueOnce({data:[{whatsapp_business_api_data:{id:'meta-interna'}}]})};
 await expect(suscribir({graph,cuenta:'123',token:'private'})).rejects.toMatchObject({status:503});
});
test('respeta el rechazo de Meta y no intenta eliminar otras suscripciones',async()=>{
 const graph={facebook:jest.fn().mockResolvedValue({success:false})};
 await expect(suscribir({graph,cuenta:'123',token:'private'})).rejects.toMatchObject({status:503});expect(graph.facebook).toHaveBeenCalledTimes(1);
 delete process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN;await expect(suscribir({graph,cuenta:'123',token:'private'})).rejects.toMatchObject({status:503});expect(graph.facebook).toHaveBeenCalledTimes(1);
});

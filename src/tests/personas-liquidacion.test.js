jest.mock('../models',()=>({Envio:{findAll:jest.fn()},EnvioItem:{},MetodoPago:{},Liquidacion:{},LiquidacionEnvio:{},Courier:{},sequelize:{}}));
jest.mock('../services/pedidoIdentificador.service',()=>({adjuntarIdentificadores:async x=>x}));
const {Envio}=require('../models');
const {previsualizar}=require('../services/liquidacion.service');
test('la rendición solo incluye pedidos de la tienda autorizada',async()=>{
 Envio.findAll.mockResolvedValue([]);
 await previsualizar({courier_id:4,fecha_desde:'2026-10-01',fecha_hasta:'2026-10-25',usuario_id:20,tienda_id:7});
 expect(Envio.findAll).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({usuario_id:20,tienda_id:7,courier_id:4})}));
});

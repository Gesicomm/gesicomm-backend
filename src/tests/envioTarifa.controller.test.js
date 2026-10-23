jest.mock('../services/redFulfillment.service',()=>({cotizarEntregaRaha:jest.fn()}));
const {cotizarEntregaRaha}=require('../controllers/envioTarifa.controller');
const Red=require('../services/redFulfillment.service');
beforeEach(()=>jest.clearAllMocks());
const response=()=>{const res={};res.status=jest.fn(()=>res);res.json=jest.fn(()=>res);return res;};
test('devuelve la tarifa y no modifica el pedido',async()=>{const res=response();Red.cotizarEntregaRaha.mockResolvedValue({cubierto:true,costo:27000});await cotizarEntregaRaha({body:{ciudad:'Luque',departamento:'Central',cantidad:2}},res);expect(res.json).toHaveBeenCalledWith({cubierto:true,costo:27000});});
test.each([{ciudad:[]},{ciudad:'Luque',pago_anticipado:'false'}])('rechaza entrada inválida sin consultar tarifas',async body=>{const res=response();await cotizarEntregaRaha({body},res);expect(res.status).toHaveBeenCalledWith(400);expect(Red.cotizarEntregaRaha).not.toHaveBeenCalled();});
test('oculta errores internos y devuelve un error recuperable',async()=>{const res=response();Red.cotizarEntregaRaha.mockRejectedValue(new Error('dato interno'));await cotizarEntregaRaha({body:{ciudad:'Luque'}},res);expect(res.status).toHaveBeenCalledWith(500);expect(res.json).toHaveBeenCalledWith({error:'No se pudo cotizar la entrega de RAHA.'});});

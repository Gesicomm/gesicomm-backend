
jest.mock('../models', () => ({ Deposito: { findAll: jest.fn() } }));
jest.mock('../services/proveedorLogistico.service', () => ({
 proveedoresComercialesGesicomm: jest.fn(), esProveedorRaha: p => p.nombre === 'RAHA',
}));
jest.mock('../services/tarifaDelivery.service', () => ({ resolverOpcionesDeRed: jest.fn(), buscarOpcion: (lista, ciudad, departamento) => lista.find(x=>x.ciudad===ciudad&&x.departamento===departamento)||null }));
const Red = require('../services/redFulfillment.service');
const Tarifas = require('../services/tarifaDelivery.service');
const Proveedores = require('../services/proveedorLogistico.service');
const {Deposito}=require('../models');
const destino={ciudad:'Luque',departamento:'Central',cantidad:2};
beforeEach(()=>{jest.clearAllMocks();Deposito.findAll.mockResolvedValue([{id:5}]);Proveedores.proveedoresComercialesGesicomm.mockResolvedValue([{id:7,nombre:'RAHA'},{id:8,nombre:'Otro'}]);});
test.each([true,false])('una tarifa única sirve sin condicionar el tipo de pago (%s)',async pago_anticipado=>{
 Tarifas.resolverOpcionesDeRed.mockImplementation(async(_,{paymentMethod})=>paymentMethod==='efectivo'?[{...destino,costo:25000}]:[]);
 expect(await Red.cotizarEntregaRaha({...destino,pago_anticipado})).toMatchObject({cubierto:true,costo:25000});
 expect(Tarifas.resolverOpcionesDeRed).toHaveBeenCalledWith({centroIds:[5],proveedorIds:[7]},{paymentMethod:'efectivo',items:[{cantidad:2}]});
});
test('si hay tarifas distintas respeta contra entrega y anticipado',async()=>{
 Tarifas.resolverOpcionesDeRed.mockImplementation(async(_,{paymentMethod})=>[{...destino,costo:paymentMethod==='efectivo'?25000:21000}]);
 expect((await Red.cotizarEntregaRaha(destino)).costo).toBe(25000);
 expect((await Red.cotizarEntregaRaha({...destino,pago_anticipado:true})).costo).toBe(21000);
});
test('no toma precios de otra ciudad, departamento o proveedor',async()=>{
 Tarifas.resolverOpcionesDeRed.mockResolvedValue([{ciudad:'Luque',departamento:'Otro',costo:10000}]);expect(await Red.cotizarEntregaRaha(destino)).toEqual({cubierto:false,costo:null});
 Proveedores.proveedoresComercialesGesicomm.mockResolvedValue([{id:8,nombre:'Otro'}]);expect(await Red.cotizarEntregaRaha(destino)).toEqual({cubierto:false,costo:null});
});
test('rechaza cantidades inválidas',async()=>{await expect(Red.cotizarEntregaRaha({...destino,cantidad:0})).rejects.toThrow('cantidad');});

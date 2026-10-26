jest.mock('../services/costoGasto.service',()=>({buscar:jest.fn(),crear:jest.fn()}));
jest.mock('../services/metaReportes.service',()=>({listarCampanas:jest.fn()}));
jest.mock('../services/metaCampanaGastos.service',()=>({}));
const financiero=require('../controllers/costoGasto.controller');
const ads=require('../controllers/metaReportes.controller');
const costos=require('../services/costoGasto.service');
const campanas=require('../services/metaReportes.service');
const respuesta=()=>({json:jest.fn(),status:jest.fn().mockReturnThis()});
beforeEach(()=>jest.clearAllMocks());
test('consulta y alta financieras usan el dueño y tienda autorizados, nunca los IDs del body',async()=>{
 const req={usuario:{id:100,tenantId:1,tiendaId:7},comercioId:20,body:{usuario_id:999,tienda_id:888}};
 await financiero.buscar(req,respuesta());
 expect(costos.buscar).toHaveBeenCalledWith(req.body,20,7);
 await financiero.crear(req,respuesta());
 expect(costos.crear).toHaveBeenCalledWith(req.body,20,1,7);
 expect(req.usuario.id).toBe(100);
});
test('publicidad delegada consulta campañas del comercio; el propietario conserva su contexto',async()=>{
 await ads.listarCampanas({usuario:{id:100,tenantId:1},comercioId:20,query:{}},respuesta());
 expect(campanas.listarCampanas).toHaveBeenLastCalledWith(1,20,{});
 await ads.listarCampanas({usuario:{id:20,tenantId:1},query:{}},respuesta());
 expect(campanas.listarCampanas).toHaveBeenLastCalledWith(1,20,{});
});

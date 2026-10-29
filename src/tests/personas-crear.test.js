jest.mock('../models',()=>({
 sequelize:{transaction:jest.fn()},Usuario:{findOne:jest.fn(),create:jest.fn()},Rol:{findOne:jest.fn()},Tienda:{findOne:jest.fn()}
}));
jest.mock('../models/TiendaMiembro',()=>({create:jest.fn()}));
jest.mock('../services/notificaciones/accesoEquipo.service',()=>({enviarBienvenidaEquipo:jest.fn()}));
const {enviarBienvenidaEquipo}=require('../services/notificaciones/accesoEquipo.service');
const bcrypt=require('bcryptjs');
const {sequelize,Usuario,Rol,Tienda}=require('../models');
const Miembro=require('../models/TiendaMiembro');
const {crear}=require('../services/accesos.service');
const propietario={id:1,nombre:'Martín',tiendaId:7,tenantId:3,rol:'usuario'};
const datos={nombre:'Ana',email:'ANA@example.com',password:'ClaveSegura123',permisos:{comercial:'ver'}};
const transaction={id:'mock-transaction'};
beforeEach(()=>{
 jest.clearAllMocks(); sequelize.transaction.mockImplementation(fn=>fn(transaction));
 Tienda.findOne.mockResolvedValue({id:7,nombre:'Tienda Asunción',inquilino_id:3});enviarBienvenidaEquipo.mockResolvedValue({enviado:true});Rol.findOne.mockResolvedValue({id:9});
 Usuario.findOne.mockResolvedValue(null);Usuario.create.mockResolvedValue({id:11});Miembro.create.mockResolvedValue({id:12});
});
test('el propietario crea una cuenta activa con bcrypt y sin devolver contraseña ni token',async()=>{
 const result=await crear(propietario,datos);
 const [values,options]=Usuario.create.mock.calls[0];
 expect(values).toMatchObject({nombre:'Ana',correo_electronico:'ana@example.com',activo:true,email_verificado:true,rol_id:9,inquilino_id:3});
 expect(values.contrasena_hash).not.toBe(datos.password);
 expect(await bcrypt.compare(datos.password,values.contrasena_hash)).toBe(true);
 expect(options).toEqual({transaction});
 expect(Miembro.create).toHaveBeenCalledWith(expect.objectContaining({usuario_id:11,tienda_id:7,estado:'activo',permisos:{comercial:'ver'},token_hash:null}),{transaction});
 expect(result.password).toBeUndefined();expect(result.token).toBeUndefined();
});
test('no sobrescribe la contraseña de una cuenta existente',async()=>{
 Usuario.findOne.mockResolvedValue({id:11});
 await expect(crear(propietario,datos)).rejects.toMatchObject({status:409});
 expect(Usuario.create).not.toHaveBeenCalled();expect(Miembro.create).not.toHaveBeenCalled();
});
test.each(['corta','sinmayusculas123','SinNumeros','A1'+'é'.repeat(36)])('rechaza contraseña inválida',async password=>{
 await expect(crear(propietario,{...datos,password})).rejects.toMatchObject({status:400});
 expect(Usuario.create).not.toHaveBeenCalled();
});
test('un colaborador no puede crear otras cuentas',async()=>{
 await expect(crear({...propietario,rol:'colaborador'},datos)).rejects.toMatchObject({status:403});
 expect(Usuario.create).not.toHaveBeenCalled();
});
test('envía la bienvenida con las credenciales después de guardar el alta',async()=>{
 const result=await crear(propietario,datos);
 expect(enviarBienvenidaEquipo).toHaveBeenCalledWith({nombre:'Ana',email:'ana@example.com',password:'ClaveSegura123',tienda:'Tienda Asunción',invitante:'Martín',permisos:{comercial:'ver'}});
 expect(result).toMatchObject({id:12,emailEnviado:true});expect(result.message).toMatch(/ana@example.com/);
 expect(JSON.stringify(result)).not.toContain(datos.password);
});
test('si el correo falla, el alta queda igual y avisa que hay que compartir el enlace',async()=>{
 enviarBienvenidaEquipo.mockResolvedValue({enviado:false});
 const result=await crear(propietario,datos);
 expect(result).toMatchObject({id:12,emailEnviado:false});expect(result.message).toMatch(/no pudimos enviar/);
});
test('no envía correo si el alta falla',async()=>{
 Usuario.findOne.mockResolvedValue({id:11});
 await expect(crear(propietario,datos)).rejects.toMatchObject({status:409});
 expect(enviarBienvenidaEquipo).not.toHaveBeenCalled();
});

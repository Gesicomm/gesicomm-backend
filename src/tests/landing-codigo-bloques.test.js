const Servicio = require('../services/landingCodigo.service');
test('conserva código por bloque de producto y combo y sus conexiones dentro de templates', () => {
 const codigo = {html:'<section data-gesicomm-ficha-bloque="confianza"><div data-gc-lista=".tarjetas"><template data-gc-filas><h3 data-gc-ref=":scope > h3" data-gc-valor>Título</h3></template></div></section>',css:'.tarjeta {color:var(--tienda-texto)}',js:'const fn=()=>{}; bloque.addEventListener("click",fn); return ()=>bloque.removeEventListener("click",fn);'};
 const venta = Servicio.limpiarVenta({presentacion_productos:{'producto:1':{v:2,codigo_bloques:{confianza:codigo}},'combo:2':{v:2,codigo_bloques:{confianza:codigo}}}});
 for (const clave of ['producto:1','combo:2']) {
  const guardado=venta.presentacion_productos[clave].codigo_bloques.confianza;
  expect(guardado.html).toContain('data-gc-filas'); expect(guardado.html).toContain('data-gc-ref'); expect(guardado.css).toBe(codigo.css); expect(guardado.js).toBe(codigo.js);
 }
});
test('aplica el aislamiento y la validación del código del lienzo a cada bloque',()=>{
 expect(()=>Servicio.limpiarVenta({presentacion_productos:{'producto:1':{v:2,codigo_bloques:{precio:{html:'<div></div>',js:'fetch("https://example.com")'}}}}})).toThrow();
 const venta=Servicio.limpiarVenta({presentacion_productos:{'combo:1':{v:2,codigo_bloques:{faq:{html:'<section data-gesicomm-ficha-bloque="faq"><script>alert(1)</script><p>Texto</p></section>',css:'.a{color:red}'}}}}});
 expect(venta.presentacion_productos['combo:1'].codigo_bloques.faq.html).not.toContain('<script');
});

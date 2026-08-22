const sequelize = require('./src/config/database');

const CONFIANZA = [
  { icono: "ShieldCheck", texto: "Garantia WINNINGSTAR incluida" },
  { icono: "Truck",       texto: "Envio a todo el pais" },
  { icono: "RotateCcw",  texto: "Cambios y devoluciones" },
  { icono: "Headphones", texto: "Soporte postventa" },
];

const CATEGORIAS = [
  {
    test: n => /bebedero|dispensador.*agua/i.test(n),
    propuesta_valor: "Agua fria o caliente al instante, sin esperar ni enchufar bidones - listo para usar desde el primer dia.",
    sobre: "El bebedero WINNINGSTAR es la solucion practica para tener agua a la temperatura exacta en segundos. Disenado para el hogar o la oficina, se conecta a 220V y trabaja en silencio. Olvidate de los bidones pesados y de esperar: simplemente servis y listo.",
    beneficios: [
      { titulo: "Agua fria y caliente al instante", texto: "Dos temperaturas disponibles sin esperar, ideales para mate, te o agua fresca." },
      { titulo: "Facil de instalar", texto: "Conexion directa a 220V, sin plomeria ni instalacion complicada." },
      { titulo: "Diseno compacto", texto: "Ocupa poco espacio y se adapta a cualquier rincon del hogar u oficina." },
      { titulo: "Bajo consumo electrico", texto: "Pensado para funcionar todo el dia sin disparar tu factura de luz." },
    ],
    faq: [
      { pregunta: "Funciona con agua de canilla o necesita bidon?", respuesta: "La mayoria funciona con bidon estandar de 20L, lo cual es mas higienico y practico." },
      { pregunta: "Que voltaje necesita?", respuesta: "Funciona a 220V, el voltaje estandar en Paraguay. Solo necesitas enchufarlo y esta listo." },
      { pregunta: "Cuanto tarda en enfriar/calentar?", respuesta: "El agua caliente esta disponible casi de inmediato. El agua fria puede tardar 15-30 minutos la primera vez." },
      { pregunta: "Es dificil limpiar el dispensador?", respuesta: "No. Los grifos son desmontables y el deposito se limpia con agua y vinagre blanco cada 3 meses." },
    ],
  },
  {
    test: n => /vent\.|ventilador/i.test(n),
    propuesta_valor: "Aire fresco y silencioso donde lo necesitas - potente, economico y listo desde el primer encendido.",
    sobre: "El ventilador WINNINGSTAR fue disenado para dar frescura real sin ruidos molestos ni consumos exagerados. Con multiples velocidades y motor eficiente, mantiene la temperatura controlada tanto en el dormitorio como en la oficina.",
    beneficios: [
      { titulo: "Potente y silencioso", texto: "Motor de alto rendimiento que mueve aire de verdad sin interrumpir el descanso." },
      { titulo: "Multiples velocidades", texto: "Eleges la intensidad que necesitas segun el calor del momento." },
      { titulo: "Oscilacion automatica", texto: "Distribuye el aire en toda la habitacion sin que tengas que moverlo." },
      { titulo: "Facil de armar y mover", texto: "Sin herramientas, listo en minutos. Liviano para llevarlo de cuarto en cuarto." },
    ],
    faq: [
      { pregunta: "Cuanto consume de electricidad?", respuesta: "El consumo esta indicado en watts en el nombre del producto. Es mucho menor al de un aire acondicionado." },
      { pregunta: "Tiene garantia?", respuesta: "Si, todos los ventiladores WINNINGSTAR incluyen garantia oficial." },
      { pregunta: "Se puede dejar encendido toda la noche?", respuesta: "Si, disenado para funcionar de forma continua. Recomendamos velocidad baja por la noche." },
      { pregunta: "Funciona a 220V?", respuesta: "Si, todos los modelos WINNINGSTAR estan disenados para 220V, el estandar de Paraguay." },
    ],
  },
  {
    test: n => /estufa/i.test(n),
    propuesta_valor: "Calor inmediato y parejo en segundos - sin esperar, sin humo, sin complicaciones.",
    sobre: "La estufa electrica WINNINGSTAR entrega calor real desde el primer encendido. Su resistencia de alta eficiencia calienta el ambiente en minutos, ideal para el invierno paraguayo sin recurrir al gas.",
    beneficios: [
      { titulo: "Calor instantaneo", texto: "La resistencia alcanza temperatura en segundos. Sin espera, sin precalentamiento." },
      { titulo: "Seguridad termica integrada", texto: "Se apaga automaticamente si detecta sobrecalentamiento, protegiendo tu hogar." },
      { titulo: "Sin llama ni humo", texto: "100% electrica. Sin gas, sin riesgos de combustion, sin monoxido de carbono." },
      { titulo: "Silenciosa y compacta", texto: "Calor eficiente sin ruido. Cabe en cualquier rincon del hogar u oficina." },
    ],
    faq: [
      { pregunta: "Que potencia necesito para mi habitacion?", respuesta: "Para ambientes hasta 12m2 alcanza con 1000-1500W. Para medianos (12-20m2), 2000W. Grandes, 3000W." },
      { pregunta: "Es seguro dejarla encendida?", respuesta: "Los modelos WINNINGSTAR tienen proteccion contra sobrecalentamiento. No dejarla sin supervision prolongada." },
      { pregunta: "Cuanto consume?", respuesta: "El consumo esta en el nombre (ej: 1500W). 1500W durante 1 hora = 1.5 kWh de consumo." },
      { pregunta: "Funciona a 220V?", respuesta: "Si, todos los modelos son para 220V/50Hz, el estandar de Paraguay." },
    ],
  },
  {
    test: n => /cuchara.*silicona|silicona.*cuchara/i.test(n),
    propuesta_valor: "Cocina sin rayar tus ollas - la cuchara de silicona que dura, no mancha y se limpia en segundos.",
    sobre: "La cuchara de silicona WINNINGSTAR protege las superficies antiadherentes de tus ollas mientras cocinas con total comodidad. Su mango ergonomico reduce la fatiga y la silicona no absorbe olores ni se decolora.",
    beneficios: [
      { titulo: "Protege el antiadherente", texto: "No raya ollas ni sartenes. La silicona es suave con todas las superficies." },
      { titulo: "Resistente al calor", texto: "Soporta hasta 230C sin deformarse ni soltar residuos en la comida." },
      { titulo: "Sin olores ni manchas", texto: "La silicona no absorbe aromas ni se tine con salsas o especias." },
      { titulo: "Facil de limpiar", texto: "Compatible con lavavajillas. A mano, el jabon la deja como nueva en segundos." },
    ],
    faq: [
      { pregunta: "Es apta para contacto con alimentos?", respuesta: "Si. Fabricada con silicona alimentaria certificada, libre de BPA y materiales toxicos." },
      { pregunta: "Se puede usar en sartenes antiadherentes?", respuesta: "Absolutamente. Es justamente para eso: protege el recubrimiento que el metal destruiria." },
      { pregunta: "Entra en el lavavajillas?", respuesta: "Si, es apta para lavavajillas. Tambien se puede lavar a mano sin problema." },
      { pregunta: "Hasta que temperatura aguanta?", respuesta: "Resiste hasta 230C de forma continua, muy por encima de las temperaturas normales de coccion." },
    ],
  },
  {
    test: n => /cuchara.*inox|inox.*cuchara/i.test(n),
    propuesta_valor: "El clasico de acero inoxidable que no se oxida, no se dobla y dura toda la vida.",
    sobre: "La cuchara de acero inoxidable WINNINGSTAR es elegante, higienica y practicamente indestructible. El acero inox de calidad alimentaria no absorbe olores, no se oxida y mantiene su brillo ano tras ano.",
    beneficios: [
      { titulo: "Acero inoxidable de calidad", texto: "No se oxida ni se corroe con el lavado frecuente ni el contacto con alimentos acidos." },
      { titulo: "Higienico y facil de limpiar", texto: "Superficie lisa que no retiene bacterias ni residuos de comida." },
      { titulo: "Larga durabilidad", texto: "Un solo producto que dura anos sin deformarse ni perder apariencia." },
      { titulo: "Apto para lavavajillas", texto: "Se puede lavar a maquina sin que pierda brillo ni forma." },
    ],
    faq: [
      { pregunta: "El acero se oxida con el tiempo?", respuesta: "No. El acero inoxidable WINNINGSTAR es resistente a la corrosion por agua, sales y alimentos acidos." },
      { pregunta: "Es apto para contacto con alimentos?", respuesta: "Si. Cumple con los estandares de acero alimentario, sin recubrimientos que puedan desprenderse." },
      { pregunta: "Entra en el lavavajillas?", respuesta: "Si, es totalmente apta para lavavajillas." },
      { pregunta: "Se puede usar para cocinar a fuego directo?", respuesta: "Las cucharas de mezclar si. Verificar que el mango sea completamente de acero antes de exponerlo al calor." },
    ],
  },
  {
    test: n => /espatula|espátula/i.test(n),
    propuesta_valor: "Gira, levanta y servis sin romper lo que cocinas - la espatula que trabaja tan bien como vos.",
    sobre: "La espatula WINNINGSTAR combina flexibilidad y resistencia para manejar alimentos con precision. Se adapta a todo tipo de superficie y temperatura con agarre firme incluso con las manos mojadas.",
    beneficios: [
      { titulo: "Flexible pero resistente", texto: "Se dobla lo justo para levantar huevos, filetes y frituras sin romperlos." },
      { titulo: "Mango ergonomico antideslizante", texto: "Firme y comodo incluso con las manos mojadas o con aceite." },
      { titulo: "Sin rayar superficies", texto: "Apta para ollas y sartenes antiadherentes. No deja marcas." },
      { titulo: "Facil de limpiar", texto: "Compatible con lavavajillas. Sin recovecos donde se acumule grasa." },
    ],
    faq: [
      { pregunta: "Funciona en sartenes antiadherentes?", respuesta: "Si. Las espatulas de silicona estan especialmente disenadas para no rayar recubrimientos antiadherentes." },
      { pregunta: "Hasta que temperatura aguanta la silicona?", respuesta: "Hasta 230C de forma continua, muy por encima de las temperaturas de coccion habituales." },
      { pregunta: "Es apta para el lavavajillas?", respuesta: "Si, todos los modelos WINNINGSTAR son aptos para lavar en lavavajillas." },
      { pregunta: "Que significa el tamano indicado?", respuesta: "Es la longitud total de la espatula. A mayor tamano, mas comoda para trabajar con ollas grandes o parrillas." },
    ],
  },
  {
    test: n => /espumadera/i.test(n),
    propuesta_valor: "Escurris el exceso de aceite y servis limpio - la espumadera inox que no se dobla ni se oxida.",
    sobre: "La espumadera de acero inoxidable WINNINGSTAR es ideal para frituras, caldos y guisos. Su red amplia escurre rapidamente y el mango largo te protege del calor.",
    beneficios: [
      { titulo: "Escurrido rapido y eficiente", texto: "Red de orificios que elimina el exceso de aceite o caldo en segundos." },
      { titulo: "Acero inox que no se oxida", texto: "Resistente al lavado frecuente, sin manchas ni corrosion." },
      { titulo: "Mango largo para seguridad", texto: "Mantiene tu mano alejada del aceite caliente y el vapor." },
      { titulo: "Higienica y duradera", texto: "Superficie lisa que no retiene residuos. Dura anos sin deteriorarse." },
    ],
    faq: [
      { pregunta: "Es apta para lavavajillas?", respuesta: "Si, el acero inoxidable WINNINGSTAR es perfectamente compatible con el lavavajillas." },
      { pregunta: "Se puede usar en frituras con aceite muy caliente?", respuesta: "Si. El acero inox no se deforma con el calor. El mango largo te protege del salpicado." },
      { pregunta: "La malla es resistente?", respuesta: "Si, esta soldada al aro perimetral para que no se afloje con el uso." },
      { pregunta: "Para que mas se puede usar?", respuesta: "Para escurrir pastas, retirar verduras de agua hirviendo, colar caldos o levantar frituras." },
    ],
  },
  {
    test: n => /juego.*cubierto|cubierto.*juego/i.test(n),
    propuesta_valor: "Cubiertos que lucen bien en la mesa y duran anos - el set completo que tu hogar necesitaba.",
    sobre: "El juego de cubiertos WINNINGSTAR combina diseno elegante y materiales duraderos para que tu mesa luzca impecable. Fabricados en acero inoxidable de alta calidad, no se oxidan ni pierden brillo lavado tras lavado.",
    beneficios: [
      { titulo: "Acero inox de larga durabilidad", texto: "No se oxidan ni se deterioran con el lavado frecuente." },
      { titulo: "Diseno elegante y moderno", texto: "Se adaptan a cualquier vajilla, desde lo cotidiano hasta los momentos especiales." },
      { titulo: "Set completo", texto: "Tenes todo lo que necesitas para equipar tu mesa sin comprar por separado." },
      { titulo: "Aptos para lavavajillas", texto: "Lavado facil sin preocupaciones. Salen sin manchas ni perdida de brillo." },
    ],
    faq: [
      { pregunta: "Cuantas personas cubre el set?", respuesta: "Esta indicado en el nombre del producto (ej: 24 unidades = servicio para 6 personas)." },
      { pregunta: "El acero se oxida?", respuesta: "No. El acero inoxidable WINNINGSTAR resiste la corrosion del agua y los alimentos." },
      { pregunta: "Entran en el lavavajillas?", respuesta: "Si. Todos los cubiertos WINNINGSTAR son aptos para lavar en lavavajillas." },
      { pregunta: "Vienen en caja de regalo?", respuesta: "Depende del modelo. Consulta con el vendedor antes de comprar si lo necesitas para regalo." },
    ],
  },
  {
    test: n => /juego.*cuchillo|cuchillo.*juego/i.test(n),
    propuesta_valor: "Corta con precision y sin esfuerzo - el set de cuchillos que equipa tu cocina de una vez.",
    sobre: "El juego de cuchillos WINNINGSTAR te da todo lo necesario para cortar, filetear y pelar con comodidad. Las hojas de acero inoxidable mantienen el filo por mas tiempo y son faciles de reafilar.",
    beneficios: [
      { titulo: "Hoja de acero de alta dureza", texto: "Mantiene el filo por mas tiempo y se puede reafilar facilmente." },
      { titulo: "Mango ergonomico antideslizante", texto: "Firme y comodo, reduce la fatiga al cortar durante mucho tiempo." },
      { titulo: "Set completo", texto: "Cada tamano de cuchillo tiene su funcion. Tenes todo en un solo set." },
      { titulo: "Faciles de limpiar", texto: "Superficies lisas sin recovecos. Aptos para lavar a mano o en lavavajillas." },
    ],
    faq: [
      { pregunta: "Cuantos cuchillos incluye?", respuesta: "La cantidad esta indicada en el nombre del producto. Incluye distintos tipos segun el set." },
      { pregunta: "Se pueden lavar en lavavajillas?", respuesta: "Pueden lavarse en lavavajillas, aunque para mantener el filo se recomienda lavar a mano." },
      { pregunta: "Como se afilan?", respuesta: "Con un afilador estandar de varilla o piedra de afilar. No requieren tecnica especial." },
      { pregunta: "Vienen con taco o porta-cuchillos?", respuesta: "Depende del modelo. Verificar en las imagenes o consultar con el vendedor." },
    ],
  },
  {
    test: n => /juego.*cocina|cocina.*juego/i.test(n),
    propuesta_valor: "Todo lo que necesitas para cocinar en un solo set - deja de buscar utensilios y empieza a cocinar.",
    sobre: "El juego de utensilios WINNINGSTAR reune en un solo set las herramientas que usas todos los dias. Cada utensilio esta disenado para una tarea especifica: mezclar, servir, escurrir, voltear.",
    beneficios: [
      { titulo: "Kit completo de una vez", texto: "Todo lo que necesitas en la cocina sin tener que comprar pieza por pieza." },
      { titulo: "Materiales aptos para alimentos", texto: "Silicona o acero alimentario sin BPA ni recubrimientos que puedan desprenderse." },
      { titulo: "Disenados para resistir", texto: "Soportan el uso diario sin deformarse, mancharse ni perder su forma." },
      { titulo: "Faciles de limpiar", texto: "La mayoria son aptos para lavavajillas. Sin rincones donde se acumule la grasa." },
    ],
    faq: [
      { pregunta: "Cuantas piezas incluye el set?", respuesta: "La cantidad esta indicada en el nombre del producto. Cada set incluye distintos tipos de utensilios." },
      { pregunta: "Son aptos para todo tipo de cocina?", respuesta: "Si, funcionan en todo tipo de cocinas: a gas, electrica, ceramica o induccion." },
      { pregunta: "Se pueden usar en ollas antiadherentes?", respuesta: "Los modelos de silicona si. Los de acero inox tambien, aunque con cuidado en superficies delicadas." },
      { pregunta: "Entran en el lavavajillas?", respuesta: "La mayoria si. Verificar las instrucciones del modelo especifico." },
    ],
  },
  {
    test: n => /pincel.*silicona|silicona.*pincel/i.test(n),
    propuesta_valor: "Pinta, barniza y glasea sin ensuciar - el pincel de silicona que no pierde cerdas ni absorbe grasa.",
    sobre: "El pincel de silicona WINNINGSTAR transforma como aplicas aceite, manteca, huevo o glase en tus preparaciones. La silicona no se cae, no absorbe bacterias y se limpia en segundos.",
    beneficios: [
      { titulo: "Sin perdida de cerdas", texto: "Las laminas de silicona no se caen ni quedan en la comida." },
      { titulo: "Resistente al calor", texto: "Soporta hasta 230C. Podes usarlo directamente sobre el horno o la parrilla." },
      { titulo: "Higienico", texto: "La silicona no absorbe bacterias ni retiene olores. Se limpia en segundos." },
      { titulo: "Distribucion pareja", texto: "Laminas flexibles que distribuyen aceite o glase de forma uniforme." },
    ],
    faq: [
      { pregunta: "Que significa el tamano 210mm?", respuesta: "Es la longitud total del pincel. 210mm es un tamano estandar comodo para ollas y moldes de horno." },
      { pregunta: "Entra en el lavavajillas?", respuesta: "Si. La silicona es perfectamente apta para el lavavajillas." },
      { pregunta: "Se puede usar en parrilla o barbacoa?", respuesta: "Si, resiste el calor directo. Ideal para pintar carnes con marinada o aceite." },
      { pregunta: "Las laminas se abren o se pegan?", respuesta: "Con el uso frecuente tienden a abrirse ligeramente, lo cual es normal y no afecta su funcionamiento." },
    ],
  },
  {
    test: n => /amassador|amasador/i.test(n),
    propuesta_valor: "Amasa sin ensuciar la mesada - el amasador de silicona que facilita y ordena tu cocina.",
    sobre: "El amasador de silicona WINNINGSTAR hace el trabajo mas limpio, facil y eficiente. Su superficie antiadherente evita que la masa se pegue y su flexibilidad permite darle forma sin que se escape por los bordes.",
    beneficios: [
      { titulo: "Superficie antiadherente", texto: "La masa no se pega. Trabajas sin harina extra y sin que se vaya por la mesada." },
      { titulo: "Flexible y manejable", texto: "Podes doblarla para transferir masas sin romperlas ni ensuciar." },
      { titulo: "Facil de limpiar", texto: "Un enjuague y queda lista. Apta para lavavajillas." },
      { titulo: "Resistente al calor", texto: "Soporta temperaturas elevadas, podes usarla como accesorio de horneado." },
    ],
    faq: [
      { pregunta: "La masa no se pega?", respuesta: "Correcto. La silicona tiene propiedades antiadherentes naturales. Raramente necesitas agregar harina." },
      { pregunta: "Para que tipos de masa sirve?", respuesta: "Para cualquier tipo: pan, pizza, pasta, galletitas, hojaldre." },
      { pregunta: "Se puede usar en el horno?", respuesta: "Si, la silicona soporta hasta 230C. Podes usarla tambien como superficie para horneado liviano." },
      { pregunta: "Como se limpia?", respuesta: "Con agua y jabon bajo la canilla. Tambien es apta para el lavavajillas." },
    ],
  },
];

async function main() {
  await sequelize.authenticate();
  const [productos] = await sequelize.query("SELECT id, nombre FROM productos WHERE activo = true ORDER BY id;");
  console.log("Total productos:", productos.length);

  let actualizados = 0;
  const sinCategoria = [];

  for (const prod of productos) {
    const cat = CATEGORIAS.find(c => c.test(prod.nombre));
    if (!cat) { sinCategoria.push(prod.nombre); continue; }

    await sequelize.query(
      "UPDATE productos SET propuesta_valor = :pv, sobre_este_producto = :sobre, beneficios = :ben::json, confianza = :conf::json, preguntas_frecuentes = :faq::json WHERE id = :id",
      {
        replacements: {
          pv: cat.propuesta_valor,
          sobre: cat.sobre,
          ben: JSON.stringify(cat.beneficios),
          conf: JSON.stringify(CONFIANZA),
          faq: JSON.stringify(cat.faq),
          id: prod.id,
        },
        type: "UPDATE",
      }
    );
    actualizados++;
    if (actualizados % 20 === 0) console.log("  ->", actualizados, "actualizados...");
  }

  console.log("\nActualizados:", actualizados);
  if (sinCategoria.length) {
    console.log("\nSin categoria (" + sinCategoria.length + "):");
    sinCategoria.forEach(n => console.log(" -", n));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

// Fix analizarSensibilidadProducto
code = code.replace(
  /const principalResult = comboPricing\.calcularPrincipal\(\s*\{\s*cost:\s*parseFloat\(producto\.precio_costo\),\s*salePrice:\s*precioEfectivo\s*\},/g,
  `const principalResult = comboPricing.calcularPrincipal(
      { cost: parseFloat(producto.precio_base), salePrice: precioEfectivo },`
);

// Fix analizarSensibilidadCombo
const badComboStr = `  static async analizarSensibilidadCombo(usuario_id, inquilino_id, combo_id) {
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO' },
      include: [{ model: ProductoComboItem, as: 'items' }],
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const upsellsPayload = combo.items.map(i => ({
      productId: i.producto_incluido_id,
      discountPercentage: parseFloat(i.descuento_porcentaje) || 0,
    }));

    // Reutiliza el motor de combos: resuelve costos reales del cat??logo,
    // nunca conf??a en precios enviados por el cliente. Ninguna de estas tres
    // llamadas depende del resultado de las otras (todas parten de \`combo\`,
    // ya resuelto arriba), as?? que van en paralelo ??? antes ped??an la
    // configuraci??n econ??mica del tenant DOS veces (una adentro de
    // ComboService.simular y otra ac??) de forma innecesariamente secuencial.
    const [resultado, config, precioPersonalizado] = await Promise.all([
      ComboService.simular(combo.producto_id, upsellsPayload, inquilino_id),
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'combo', combo.id),
    ]);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(combo.precio_total);

    const totalCost = resultado.combo.totalCost;
    const profit = Math.round((precioEfectivo - totalCost) * 100) / 100;
    const margin = precioEfectivo > 0 ? Math.round((profit / precioEfectivo) * 10000) / 10000 : 0;

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      combo: {
        id: combo.id,
        nombre: combo.nombre,
        precio_base: parseFloat(combo.precio_total),
        precio_minimo: combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit,
      margin,
      estado: this.anotarEstado(margin, minimumMarginDecimal),
      comparison: resultado.comparison,
      sensitivity,
      warnings: resultado.warnings,
    };
  }`;

// Notice we need to use a regex or indexOf because of the comments and line endings
const startIndex = code.indexOf("static async analizarSensibilidadCombo");
const endIndex = code.indexOf("}", code.indexOf("return {", startIndex)) + 4; // match the end of the function

if (startIndex === -1 || endIndex < startIndex) {
    console.error("Could not find analizarSensibilidadCombo block");
    process.exit(1);
}

const badBlock = code.substring(startIndex, endIndex);

const goodBlock = `static async analizarSensibilidadCombo(usuario_id, inquilino_id, combo_id) {
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO' }
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const [config, precioPersonalizado] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'combo', combo.id),
    ]);
    
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(combo.precio_total);

    const principalResult = comboPricing.calcularPrincipal(
      { cost: parseFloat(combo.precio_total), salePrice: precioEfectivo },
      costs,
    );

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost: principalResult.totalCosts },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      combo: {
        id: combo.id,
        nombre: combo.nombre,
        precio_base: parseFloat(combo.precio_total),
        precio_minimo: combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit: principalResult.profit,
      margin: principalResult.margin,
      estado: this.anotarEstado(principalResult.margin, minimumMarginDecimal),
      sensitivity,
      warnings: [],
    };
  }`;

code = code.replace(badBlock, goodBlock);
fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('Fixed sensitivity logic');

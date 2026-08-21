const fs = require('fs');
const path = require('path');

const file = path.join('C:\\Proyectos\\Gesicom\\gesicomm-backend\\src\\services\\precioUsuario.service.js');
let content = fs.readFileSync(file, 'utf8');

const newMethod = `  static async listarCatalogo(usuario_id, inquilino_id, filtros = {}) {
    const { sequelize, Categoria } = require('../models');
    const {
      page = 1, limit = 10, busqueda = '', filtroCategoria = '', orden = 'nombre', tipo = 'todos'
    } = filtros;
    const offset = (page - 1) * limit;

    const replacements = { usuario_id, inquilino_id };
    
    // Filtro de categoría: necesitamos resolver su nombre a su id si viene filtroCategoria, 
    // o simplemente buscarla
    let catFilter = '';
    if (filtroCategoria) {
      const cat = await Categoria.findOne({ where: { nombre: filtroCategoria, inquilino_id } });
      if (cat) {
        replacements.categoria_id = cat.id;
        catFilter = 'AND p.categoria_id = :categoria_id';
      } else {
        // Categoria no encontrada, devolver vacío
        return { items: [], total: 0, page: 1, totalPages: 0, categorias: [] };
      }
    }

    let searchFilter = '';
    if (busqueda.trim()) {
      replacements.busqueda = \`%\${busqueda.trim()}%\`;
      searchFilter = 'AND (c.nombre ILIKE :busqueda OR c.descripcion ILIKE :busqueda)';
    }

    let orderSql = 'ORDER BY nombre ASC';
    if (orden === 'recientes') orderSql = 'ORDER BY created_at DESC';
    if (orden === 'precio-asc') orderSql = 'ORDER BY precio_efectivo ASC';
    if (orden === 'precio-desc') orderSql = 'ORDER BY precio_efectivo DESC';

    const productosSql = \`
      SELECT p.id, 'producto' as tipo, p.nombre, p.descripcion_corta as descripcion, p.created_at, p.categoria_id,
        COALESCE(pu.precio, p.precio_base) as precio_efectivo
      FROM productos p
      LEFT JOIN precio_usuarios pu ON pu.tipo = 'producto' AND pu.referencia_id = p.id AND pu.usuario_id = :usuario_id
      WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
      \${catFilter}
      \${searchFilter.replace(/c\\./g, 'p.').replace(/descripcion/g, 'descripcion_corta')}
    \`;

    const combosSql = \`
      SELECT c.id, 'combo' as tipo, c.nombre, c.descripcion, c.created_at, p.categoria_id,
        COALESCE(pu.precio, c.precio_total) as precio_efectivo
      FROM producto_combos c
      INNER JOIN productos p ON c.producto_id = p.id AND p.activo = true
      LEFT JOIN precio_usuarios pu ON pu.tipo = 'combo' AND pu.referencia_id = c.id AND pu.usuario_id = :usuario_id
      WHERE c.inquilino_id = :inquilino_id AND c.estado = 'ACTIVO'
      \${catFilter}
      \${searchFilter}
    \`;

    let finalQuery = '';
    if (tipo === 'producto') {
      finalQuery = productosSql;
    } else if (tipo === 'combo') {
      finalQuery = combosSql;
    } else {
      finalQuery = \`(\${productosSql}) UNION ALL (\${combosSql})\`;
    }

    const countQuery = \`SELECT COUNT(*) as total FROM (\${finalQuery}) as t\`;
    const dataQuery = \`\${finalQuery} \${orderSql} LIMIT :limit OFFSET :offset\`;
    
    replacements.limit = parseInt(limit);
    replacements.offset = parseInt(offset);

    const [countResult, paginatedItems] = await Promise.all([
      sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(dataQuery, { replacements, type: sequelize.QueryTypes.SELECT })
    ]);

    const total = parseInt(countResult[0]?.total || 0);
    
    const idsProductos = paginatedItems.filter(i => i.tipo === 'producto').map(i => i.id);
    const idsCombos = paginatedItems.filter(i => i.tipo === 'combo').map(i => i.id);

    // Obtener las entidades completas y categorias unicas en paralelo
    const [productos, combos, precios, categoriasUnicasData] = await Promise.all([
      idsProductos.length ? Producto.findAll({
        where: { id: { [Op.in]: idsProductos } },
        attributes: [
          'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_minimo',
          'precio_tachado', 'cantidad_disponible', 'destacado', 'created_at', 'categoria_id'
        ],
        include: [
          { association: 'categoria', attributes: ['id', 'nombre'] },
          { model: Marca, attributes: ['id', 'nombre'] },
        ]
      }) : [],
      idsCombos.length ? ProductoCombo.findAll({
        where: { id: { [Op.in]: idsCombos } },
        attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id', 'created_at'],
        include: [
          {
            model: ProductoComboItem,
            as: 'items',
            attributes: ['id'],
            include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre'] }],
          },
          {
            model: Producto,
            as: 'producto_padre',
            attributes: ['id', 'cantidad_disponible', 'categoria_id'],
            required: true,
            include: [
              { association: 'categoria', attributes: ['id', 'nombre'] },
              { model: Marca, attributes: ['id', 'nombre'] },
            ],
          },
        ]
      }) : [],
      PrecioUsuario.findAll({ where: { usuario_id, tipo: 'producto', referencia_id: { [Op.in]: idsProductos } } }).then(p1 => 
        PrecioUsuario.findAll({ where: { usuario_id, tipo: 'combo', referencia_id: { [Op.in]: idsCombos } } }).then(p2 => [...p1, ...p2])
      ),
      // Obtenemos categorias únicas del tenant de los productos (solo los que están activos) para los filtros
      sequelize.query(\`
        SELECT DISTINCT c.nombre 
        FROM categorias c 
        INNER JOIN productos p ON p.categoria_id = c.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY c.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);

    const mapaPrecios = new Map(precios.map(p => [\`\${p.tipo}:\${p.referencia_id}\`, parseFloat(p.precio)]));

    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
    ];
    const imgMap = new Map();
    if (idsParaImagen.length > 0) {
      const imagenes = await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: idsParaImagen } },
        attributes: ['producto_id', 'url'],
        order: [['es_principal', 'DESC'], ['orden', 'ASC']],
      });
      imagenes.forEach(img => {
        if (!imgMap.has(img.producto_id)) {
          imgMap.set(img.producto_id, img.url);
        }
      });
    }

    const mapaProductosDto = new Map(productos.map(p => {
      const precioUsuario = mapaPrecios.has(\`producto:\${p.id}\`) ? mapaPrecios.get(\`producto:\${p.id}\`) : null;
      const precioBase = parseFloat(p.precio_base);
      return [p.id, {
        id: p.id,
        tipo: 'producto',
        nombre: p.nombre,
        descripcion: p.descripcion_corta,
        descripcion_larga: p.descripcion_larga,
        precio_base: precioBase,
        precio_minimo: p.precio_minimo !== null ? parseFloat(p.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
        imagen: imgMap.get(p.id) || null,
        categoria: p.categoria?.nombre || null,
        marca: p.Marca?.nombre || null,
        stock: p.cantidad_disponible,
        destacado: !!p.destacado,
        creado_en: p.created_at,
        slug: p.slug,
      }];
    }));

    const mapaCombosDto = new Map(combos.map(c => {
      const precioUsuario = mapaPrecios.has(\`combo:\${c.id}\`) ? mapaPrecios.get(\`combo:\${c.id}\`) : null;
      const precioBase = parseFloat(c.precio_total);
      const padre = c.producto_padre;
      return [c.id, {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        productos_incluidos: (c.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean),
        imagen: padre ? (imgMap.get(padre.id) || null) : null,
        categoria: padre?.categoria?.nombre || null,
        marca: padre?.Marca?.nombre || null,
        stock: padre?.cantidad_disponible ?? null,
        destacado: false,
        creado_en: c.created_at,
      }];
    }));

    // Mantener el orden paginado original
    const items = paginatedItems.map(item => {
      if (item.tipo === 'producto') return mapaProductosDto.get(item.id);
      return mapaCombosDto.get(item.id);
    }).filter(Boolean);

    return { 
      items, 
      total, 
      page: parseInt(page), 
      totalPages: Math.ceil(total / limit),
      categorias: categoriasUnicas
    };
  }`;

const regex = /  static async listarCatalogo[\s\S]*?    return \{ productos: productosDto, combos: combosDto \};\n  }/;
content = content.replace(regex, newMethod);

fs.writeFileSync(file, content, 'utf8');
console.log('Done!');

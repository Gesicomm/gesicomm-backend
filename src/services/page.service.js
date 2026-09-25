const { Page, PageVersion, Tienda, Usuario } = require('../models');
const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.join(__dirname, '../schemas/page-schema-v2.json');
const pageSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateSchema = ajv.compile(pageSchema);

class PageService {
  static validate(schemaJson) {
    const valid = validateSchema(schemaJson);
    if (!valid) {
      throw new Error('Invalid PageSchema: ' + ajv.errorsText(validateSchema.errors));
    }
  }

  static async list(tienda_id, { page = 1, limit = 20, estado = null } = {}) {
    const offset = (page - 1) * limit;
    const where = { tienda_id };
    if (estado) where.estado = estado;

    const { count, rows } = await Page.findAndCountAll({
      where,
      limit,
      offset,
      order: [['updated_at', 'DESC']]
    });

    return { total: count, pages: rows };
  }

  static async create(tienda_id, payload, created_by) {
    const { nombre, slug, page_type, schema_json, prompt } = payload;
    
    // Validar JSON usando AJV
    this.validate(schema_json);

    // Crear la pagina en draft
    const newPage = await Page.create({
      tienda_id,
      nombre,
      slug,
      page_type: page_type || 'landing',
      estado: 'draft'
    });

    // Crear la version inicial
    const version = await PageVersion.create({
      page_id: newPage.id,
      revision: 1,
      schema_json,
      source: 'AI_GENERATION',
      prompt,
      created_by
    });

    await newPage.update({ current_draft_version_id: version.id });
    
    return { page: newPage, version };
  }

  static async getById(page_id, tienda_id) {
    const page = await Page.findOne({
      where: { id: page_id, tienda_id },
      include: [
        { model: PageVersion, as: 'current_draft_version' },
        { model: PageVersion, as: 'published_version' }
      ]
    });
    if (!page) throw new Error('Page not found');
    return page;
  }

  static async createVersion(page_id, tienda_id, payload, created_by) {
    const page = await this.getById(page_id, tienda_id);
    const { schema_json, source, prompt, parent_version_id } = payload;
    
    this.validate(schema_json);

    // Obtener la ultima revision
    const lastVersion = await PageVersion.findOne({
      where: { page_id },
      order: [['revision', 'DESC']]
    });
    
    const revision = lastVersion ? lastVersion.revision + 1 : 1;

    const version = await PageVersion.create({
      page_id,
      revision,
      schema_json,
      source: source || 'AI_PATCH',
      prompt,
      created_by,
      parent_version_id
    });

    await page.update({ current_draft_version_id: version.id, estado: 'draft' });

    return version;
  }

  static async listVersions(page_id, tienda_id) {
    const page = await this.getById(page_id, tienda_id);
    return PageVersion.findAll({
      where: { page_id },
      order: [['revision', 'DESC']],
      include: [{ model: Usuario, as: 'creator', attributes: ['id', 'nombre', 'email'] }]
    });
  }

  static async publish(page_id, tienda_id, version_id) {
    const page = await this.getById(page_id, tienda_id);
    const version = await PageVersion.findOne({ where: { id: version_id, page_id } });
    if (!version) throw new Error('Version not found');

    await page.update({
      published_version_id: version.id,
      estado: 'published'
    });
    return page;
  }

  static async rollback(page_id, tienda_id, target_version_id, created_by) {
    const page = await this.getById(page_id, tienda_id);
    const targetVersion = await PageVersion.findOne({ where: { id: target_version_id, page_id } });
    if (!targetVersion) throw new Error('Target version not found');

    // El rollback crea una nueva revision basada en la vieja
    return this.createVersion(page_id, tienda_id, {
      schema_json: targetVersion.schema_json,
      source: 'ROLLBACK',
      parent_version_id: targetVersion.id,
      prompt: 'Rolled back to version ' + targetVersion.revision
    }, created_by);
  }
}

module.exports = PageService;

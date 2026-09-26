'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_generation_logs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      tienda_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tiendas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      landing_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        // Sin FK: la landing puede haberse borrado (o, en crearDesdeIA, el
        // intento pudo fallar antes de que la landing llegara a existir).
        // El log tiene que sobrevivir aunque la landing no.
      },
      // 'generate' | 'edit' — cuál de los dos endpoints fue el disparador
      // (el repair, si se usó, no cuenta como operación propia: repair_used
      // ya lo indica).
      operacion: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      // 'landing' | 'product' — el page_type mandado al RAG.
      page_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      // 'inicio' | 'producto' | 'producto_especifico' — el target del
      // Asistente IA (ver AILandingService.regenerarConIA). NULL en
      // crearDesdeIA (siempre 'inicio', pero no pasa por regenerarConIA).
      target: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      content_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      prompt: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      modelo: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      latencia_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      tokens_input: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      tokens_output: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      repair_used: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // true = terminó guardándose (con o sin repair); false = se rechazó
      // (ver validation_errors) y no se tocó la landing.
      exitoso: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Errores de validarTodo() del intento FINAL (vacío si exitoso=true
      // sin haber necesitado repair; puede tener contenido aunque
      // exitoso=true si el repair los corrigió — ver validation_errors_pre).
      validation_errors: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      // Errores del intento ANTES del repair — para poder medir "cuántas
      // veces el primer intento falla" aunque el repair lo haya arreglado.
      validation_errors_pre_repair: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('ai_generation_logs', ['tienda_id', 'created_at'], {
      name: 'ai_generation_logs_tienda_fecha',
    });
    await queryInterface.addIndex('ai_generation_logs', ['landing_id'], {
      name: 'ai_generation_logs_landing',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_generation_logs');
  },
};

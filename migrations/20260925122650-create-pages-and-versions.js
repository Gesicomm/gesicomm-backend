'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      tienda_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'tiendas',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      page_type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'landing' // home, landing, product, category
      },
      slug: {
        type: Sequelize.STRING,
        allowNull: false
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: false
      },
      estado: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'draft' // draft, published, archived
      },
      published_version_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      current_draft_version_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('pages', ['tienda_id', 'slug'], {
      unique: true,
      name: 'pages_tienda_slug_unique'
    });

    await queryInterface.createTable('page_versions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      page_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'pages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      revision: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      schema_json: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      source: {
        type: Sequelize.STRING,
        allowNull: false, // AI_GENERATION, AI_PATCH, USER_EDITOR, ROLLBACK
        defaultValue: 'AI_GENERATION'
      },
      prompt: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'usuarios',
          key: 'id'
        }
      },
      parent_version_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'page_versions',
          key: 'id'
        }
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('page_versions', ['page_id', 'revision'], {
      unique: true,
      name: 'page_versions_page_revision_unique'
    });
    
    // Add the FKs that reference page_versions now that it's created
    await queryInterface.addConstraint('pages', {
      fields: ['published_version_id'],
      type: 'foreign key',
      name: 'pages_published_version_fk',
      references: {
        table: 'page_versions',
        field: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.addConstraint('pages', {
      fields: ['current_draft_version_id'],
      type: 'foreign key',
      name: 'pages_current_draft_version_fk',
      references: {
        table: 'page_versions',
        field: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('pages', 'pages_published_version_fk');
    await queryInterface.removeConstraint('pages', 'pages_current_draft_version_fk');
    await queryInterface.dropTable('page_versions');
    await queryInterface.dropTable('pages');
  }
};

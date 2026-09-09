const { sequelize } = require('../src/models');

async function migrarAuthTracking() {
  const queries = [
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    `CREATE TABLE IF NOT EXISTS "user_sessions" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "usuario_id" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
      "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "ended_at" TIMESTAMP WITH TIME ZONE NULL,
      "estado" VARCHAR(20) NOT NULL DEFAULT 'activa',
      "ip" VARCHAR(64) NULL,
      "user_agent" TEXT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "auth_events" (
      "id" SERIAL PRIMARY KEY,
      "usuario_id" INTEGER NULL REFERENCES "usuarios"("id") ON DELETE SET NULL,
      "email" VARCHAR(255) NULL,
      "tipo" VARCHAR(60) NOT NULL,
      "resultado" VARCHAR(20) NOT NULL DEFAULT 'ok',
      "ip" VARCHAR(64) NULL,
      "user_agent" TEXT NULL,
      "session_id" UUID NULL REFERENCES "user_sessions"("id") ON DELETE SET NULL,
      "metadata" JSONB NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS "auth_notifications" (
      "id" SERIAL PRIMARY KEY,
      "tipo" VARCHAR(60) NOT NULL,
      "titulo" VARCHAR(120) NOT NULL,
      "mensaje" VARCHAR(255) NOT NULL,
      "usuario_id" INTEGER NULL REFERENCES "usuarios"("id") ON DELETE SET NULL,
      "auth_event_id" INTEGER NULL REFERENCES "auth_events"("id") ON DELETE SET NULL,
      "leida" BOOLEAN NOT NULL DEFAULT FALSE,
      "metadata" JSONB NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS "idx_user_sessions_usuario" ON "user_sessions" ("usuario_id")',
    'CREATE INDEX IF NOT EXISTS "idx_user_sessions_last_seen" ON "user_sessions" ("last_seen_at")',
    'CREATE INDEX IF NOT EXISTS "idx_user_sessions_estado" ON "user_sessions" ("estado")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_events_usuario" ON "auth_events" ("usuario_id")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_events_tipo" ON "auth_events" ("tipo")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_events_created_at" ON "auth_events" ("created_at")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_events_session" ON "auth_events" ("session_id")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_notifications_leida" ON "auth_notifications" ("leida")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_notifications_created_at" ON "auth_notifications" ("created_at")',
    'CREATE INDEX IF NOT EXISTS "idx_auth_notifications_tipo" ON "auth_notifications" ("tipo")',
  ];

  for (const q of queries) {
    await sequelize.query(q);
  }
}

module.exports = { migrarAuthTracking };

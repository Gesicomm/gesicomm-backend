-- Migración: nuevo esquema automatization_hub para integraciones OAuth
-- externas (proveedores OAuth propios, flujo de autorización, identidades
-- vinculadas, MFA y auditoría), adaptado del esquema `auth` de Supabase.
--
-- Cambios respecto del original:
--   * Todos los PK/FK internos pasan de UUID a SERIAL/INTEGER
--     (autoincremental), como el resto de las tablas de Gesicomm.
--   * `json` -> `jsonb` en todas las columnas de payload/config.
--   * `character varying` de IP -> `inet` (tipo nativo, valida formato).
--   * Se OMITE `instances`: es el concepto de Supabase para múltiples
--     proyectos GoTrue en una misma base. Gesicomm ya tiene tenants vía
--     `usuarios.inquilino_id`; no aplica acá.
--   * `web_authn_aaguid` se mantiene UUID a propósito: es un identificador
--     estándar de fabricante de autenticador (WebAuthn AAGUID), no un PK
--     nuestro — convertirlo a numérico no tendría sentido.
--   * `mfa_amr_claims.session_id` y `oauth_authorizations.client_id` no
--     tienen FK real: las tablas `sessions` / `oauth_clients` del dump
--     original no fueron incluidas en el pedido. Quedan como INTEGER
--     sueltos hasta que se defina si hacen falta.
--   * user_id en las tablas que lo necesitan apunta a `public.usuarios(id)`,
--     que ya es la tabla de usuarios real de Gesicomm.
--   * Pendiente de decisión de negocio (no se resuelve acá): varios campos
--     quedan en texto plano en el dump original (client_secret,
--     provider_access_token, provider_refresh_token, otp_code, secret de
--     mfa_factors). Gesicomm ya tiene un patrón de cifrado a nivel
--     aplicación para tokens sensibles (ENCRYPTION_KEY, usado en
--     MetaIntegration.access_token) — conviene aplicar el mismo acá antes
--     de guardar nada real en estas columnas.
--
-- Idempotente: se puede correr más de una vez sin efecto.

CREATE SCHEMA IF NOT EXISTS automatization_hub;

-- ------------------------------------------------------------------
-- custom_oauth_providers: proveedores OAuth configurados (Google, un
-- proveedor propio, etc.) para conectar integraciones externas.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.custom_oauth_providers (
  id                       SERIAL PRIMARY KEY,
  provider_type            TEXT NOT NULL,
  identifier               TEXT NOT NULL,
  name                     TEXT NOT NULL,
  client_id                TEXT NOT NULL,
  client_secret            TEXT NOT NULL,
  acceptable_client_ids    TEXT[] NOT NULL DEFAULT '{}',
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  pkce_enabled             BOOLEAN NOT NULL DEFAULT true,
  attribute_mapping        JSONB NOT NULL DEFAULT '{}',
  authorization_params     JSONB NOT NULL DEFAULT '{}',
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  email_optional           BOOLEAN NOT NULL DEFAULT false,
  issuer                   TEXT,
  discovery_url            TEXT,
  skip_nonce_check         BOOLEAN NOT NULL DEFAULT false,
  cached_discovery         JSONB,
  discovery_cached_at      TIMESTAMPTZ,
  authorization_url        TEXT,
  token_url                TEXT,
  userinfo_url             TEXT,
  jwks_uri                 TEXT,
  custom_claims_allowlist  TEXT[] NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_type, identifier)
);

-- ------------------------------------------------------------------
-- oauth_authorizations: cada intento de autorización OAuth en curso.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.oauth_authorizations (
  id                     SERIAL PRIMARY KEY,
  authorization_id       TEXT NOT NULL UNIQUE,
  client_id              INTEGER, -- ver nota: sin FK, tabla de clients no definida en este pedido
  user_id                INTEGER REFERENCES public.usuarios(id),
  redirect_uri           TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  state                  TEXT,
  resource               TEXT,
  code_challenge         TEXT,
  code_challenge_method  TEXT,
  response_type          TEXT NOT NULL DEFAULT 'code',
  status                 TEXT NOT NULL DEFAULT 'pending',
  authorization_code     TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- flow_state: estado de un flujo de login/oauth en progreso (PKCE, etc).
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.flow_state (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER REFERENCES public.usuarios(id),
  auth_code               TEXT,
  code_challenge_method   TEXT,
  code_challenge          TEXT,
  provider_type           TEXT NOT NULL,
  provider_access_token   TEXT,
  provider_refresh_token  TEXT,
  authentication_method   TEXT NOT NULL,
  auth_code_issued_at     TIMESTAMPTZ,
  invite_token            TEXT,
  referrer                TEXT,
  oauth_client_state_id   INTEGER, -- ver nota: sin FK, tabla oauth_clients no definida en este pedido
  linking_target_id       INTEGER REFERENCES public.usuarios(id),
  email_optional          BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- identities: identidades de terceros vinculadas a un usuario Gesicomm.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.identities (
  id               SERIAL PRIMARY KEY,
  provider_id      TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES public.usuarios(id),
  identity_data    JSONB NOT NULL,
  provider         TEXT NOT NULL,
  email            TEXT,
  last_sign_in_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

-- ------------------------------------------------------------------
-- mfa_factors: factores MFA registrados por usuario.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.mfa_factors (
  id                          SERIAL PRIMARY KEY,
  user_id                     INTEGER NOT NULL REFERENCES public.usuarios(id),
  friendly_name               TEXT,
  factor_type                 TEXT NOT NULL,
  status                      TEXT NOT NULL,
  secret                      TEXT,
  phone                       TEXT,
  last_challenged_at          TIMESTAMPTZ,
  web_authn_credential        JSONB,
  web_authn_aaguid            UUID, -- identificador estándar del fabricante, no un PK propio
  last_webauthn_challenge_data JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------
-- mfa_challenges: desafíos MFA emitidos contra un factor.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.mfa_challenges (
  id                     SERIAL PRIMARY KEY,
  factor_id              INTEGER NOT NULL REFERENCES automatization_hub.mfa_factors(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at            TIMESTAMPTZ,
  ip_address             INET NOT NULL,
  otp_code               TEXT,
  web_authn_session_data JSONB
);

-- ------------------------------------------------------------------
-- mfa_amr_claims: métodos de autenticación acreditados en una sesión.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.mfa_amr_claims (
  id                     SERIAL PRIMARY KEY,
  session_id             INTEGER NOT NULL, -- ver nota: sin FK, tabla sessions no definida en este pedido
  authentication_method  TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, authentication_method)
);

-- ------------------------------------------------------------------
-- audit_log_entries: auditoría de eventos de todo lo anterior.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automatization_hub.audit_log_entries (
  id          SERIAL PRIMARY KEY,
  inquilino_id INTEGER REFERENCES public.inquilinos(id), -- reemplaza a instance_id (concepto Supabase que no aplica)
  payload     JSONB,
  ip_address  INET NOT NULL DEFAULT '0.0.0.0',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

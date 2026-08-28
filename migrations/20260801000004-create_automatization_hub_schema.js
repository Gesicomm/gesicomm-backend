'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE SCHEMA IF NOT EXISTS automatization_hub;

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

      CREATE TABLE IF NOT EXISTS automatization_hub.oauth_authorizations (
        id                     SERIAL PRIMARY KEY,
        authorization_id       TEXT NOT NULL UNIQUE,
        client_id              INTEGER,
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
        oauth_client_state_id   INTEGER,
        linking_target_id       INTEGER REFERENCES public.usuarios(id),
        email_optional          BOOLEAN NOT NULL DEFAULT false,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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
        web_authn_aaguid            UUID,
        last_webauthn_challenge_data JSONB,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS automatization_hub.mfa_challenges (
        id                     SERIAL PRIMARY KEY,
        factor_id              INTEGER NOT NULL REFERENCES automatization_hub.mfa_factors(id) ON DELETE CASCADE,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        verified_at            TIMESTAMPTZ,
        ip_address             INET NOT NULL,
        otp_code               TEXT,
        web_authn_session_data JSONB
      );

      CREATE TABLE IF NOT EXISTS automatization_hub.mfa_amr_claims (
        id                     SERIAL PRIMARY KEY,
        session_id             INTEGER NOT NULL,
        authentication_method  TEXT NOT NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (session_id, authentication_method)
      );

      CREATE TABLE IF NOT EXISTS automatization_hub.audit_log_entries (
        id          SERIAL PRIMARY KEY,
        inquilino_id INTEGER REFERENCES public.inquilinos(id),
        payload     JSONB,
        ip_address  INET NOT NULL DEFAULT '0.0.0.0',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS automatization_hub.audit_log_entries CASCADE;
      DROP TABLE IF EXISTS automatization_hub.mfa_amr_claims CASCADE;
      DROP TABLE IF EXISTS automatization_hub.mfa_challenges CASCADE;
      DROP TABLE IF EXISTS automatization_hub.mfa_factors CASCADE;
      DROP TABLE IF EXISTS automatization_hub.identities CASCADE;
      DROP TABLE IF EXISTS automatization_hub.flow_state CASCADE;
      DROP TABLE IF EXISTS automatization_hub.oauth_authorizations CASCADE;
      DROP TABLE IF EXISTS automatization_hub.custom_oauth_providers CASCADE;
      DROP SCHEMA IF EXISTS automatization_hub CASCADE;
    `);
  }
};

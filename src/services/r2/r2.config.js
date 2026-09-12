'use strict';

const REQUIRED_R2_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_REGION',
];

class R2ConfigError extends Error {
  constructor(variable) {
    super(`R2 configuration error: ${variable} is missing`);
    this.name = 'R2ConfigError';
    this.variable = variable;
    this.status = 500;
  }
}

function getR2Config(env = process.env) {
  for (const variable of REQUIRED_R2_ENV_VARS) {
    if (!env[variable]) {
      throw new R2ConfigError(variable);
    }
  }

  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    region: env.R2_REGION || 'auto',
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || null,
  };
}

function buildPublicUrl(storageKey, env = process.env) {
  const baseUrl = env.R2_PUBLIC_BASE_URL;
  if (!baseUrl) return `/${storageKey}`;
  return `${baseUrl.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
}

module.exports = {
  REQUIRED_R2_ENV_VARS,
  R2ConfigError,
  getR2Config,
  buildPublicUrl,
};

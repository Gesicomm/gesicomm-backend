'use strict';

class R2StorageError extends Error {
  constructor(message, { code, operation, key, status = 500, retryable = false } = {}) {
    super(message);
    this.name = 'R2StorageError';
    this.code = code;
    this.operation = operation;
    this.key = key;
    this.status = status;
    this.retryable = retryable;
  }
}

function getAwsErrorCode(error) {
  return error?.name || error?.Code || error?.code || error?.$metadata?.httpStatusCode || 'UnknownError';
}

function normalizeR2Error(error, { operation, key } = {}) {
  if (error instanceof R2StorageError) return error;

  const code = getAwsErrorCode(error);
  const statusCode = error?.$metadata?.httpStatusCode;
  const retryable = !!error?.$retryable;

  if (code === 'NoSuchKey' || code === 'NotFound' || statusCode === 404) {
    return new R2StorageError('El objeto solicitado no existe.', {
      code: 'NoSuchKey',
      operation,
      key,
      status: 404,
      retryable: false,
    });
  }

  if (code === 'AccessDenied' || statusCode === 403) {
    return new R2StorageError('No se pudo acceder al almacenamiento.', {
      code: 'AccessDenied',
      operation,
      key,
      status: 403,
      retryable: false,
    });
  }

  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return new R2StorageError('Credenciales de almacenamiento inválidas.', {
      code,
      operation,
      key,
      status: 500,
      retryable: false,
    });
  }

  if (code === 'NoSuchBucket') {
    return new R2StorageError('El bucket de almacenamiento no existe.', {
      code,
      operation,
      key,
      status: 500,
      retryable: false,
    });
  }

  if (code === 'TimeoutError' || code === 'RequestTimeout' || error?.errno === 'ETIMEDOUT') {
    return new R2StorageError('Tiempo de espera agotado al contactar almacenamiento.', {
      code: 'Timeout',
      operation,
      key,
      status: 504,
      retryable: true,
    });
  }

  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) {
    return new R2StorageError('Error de red al contactar almacenamiento.', {
      code: error.code,
      operation,
      key,
      status: 503,
      retryable: true,
    });
  }

  return new R2StorageError('No se pudo completar la operación de almacenamiento.', {
    code,
    operation,
    key,
    status: 500,
    retryable,
  });
}

module.exports = {
  R2StorageError,
  normalizeR2Error,
};

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

  // Node agrupa los fallos de conexión IPv4/IPv6 en AggregateError.
  // Revisar también sus errores internos evita perder el código de red real.
  const networkCodes = ['EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'];
  const connectionErrors = [error, error?.cause, ...(Array.isArray(error?.errors) ? error.errors : [])];
  const networkError = connectionErrors.find(item => networkCodes.includes(item?.code));
  if (networkError) {
    const blocked = ['EACCES', 'EPERM'].includes(networkError.code);
    const timeout = networkError.code === 'ETIMEDOUT';
    const message = blocked
      ? 'El servidor no tiene permiso para conectarse al almacenamiento.'
      : timeout
        ? 'Tiempo de espera agotado al contactar almacenamiento.'
        : 'Error de red al contactar almacenamiento.';
    return new R2StorageError(message, {
      code: networkError.code,
      operation,
      key,
      status: timeout ? 504 : 503,
      retryable: !blocked,
    });
  }

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

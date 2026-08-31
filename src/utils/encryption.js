const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
// IV length must be 12 bytes for GCM
const IV_LENGTH = 12;
// Auth tag is 16 bytes
const AUTH_TAG_LENGTH = 16;

/**
 * Cifra un texto usando AES-256-GCM.
 * @param {string} text - Texto a cifrar.
 * @returns {string} Texto cifrado en formato hex (iv:authTag:encryptedData).
 */
function encrypt(text) {
  if (!text) return text;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY no está configurada en las variables de entorno.');
  }

  // La key debe ser de 32 bytes (256 bits).
  let keyBuffer;
  if (Buffer.from(encryptionKey, 'hex').length === 32) {
    keyBuffer = Buffer.from(encryptionKey, 'hex');
  } else {
    keyBuffer = Buffer.from(encryptionKey).subarray(0, 32);
    if (keyBuffer.length < 32) {
      const paddedKey = Buffer.alloc(32);
      keyBuffer.copy(paddedKey);
      keyBuffer = paddedKey;
    }
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descifra un texto cifrado con la función encrypt.
 * @param {string} encryptedText - Texto cifrado.
 * @returns {string} Texto descifrado.
 */
function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY no está configurada en las variables de entorno.');
  }

  let keyBuffer;
  if (Buffer.from(encryptionKey, 'hex').length === 32) {
    keyBuffer = Buffer.from(encryptionKey, 'hex');
  } else {
    keyBuffer = Buffer.from(encryptionKey).subarray(0, 32);
    if (keyBuffer.length < 32) {
      const paddedKey = Buffer.alloc(32);
      keyBuffer.copy(paddedKey);
      keyBuffer = paddedKey;
    }
  }

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de texto cifrado inválido.');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};

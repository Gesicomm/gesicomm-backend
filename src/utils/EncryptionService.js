const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
// ENCRYPTION_KEY debe ser una cadena hexadecimal de 64 caracteres (32 bytes).
// Si no está definida en entorno dev, generamos una aleatoria por seguridad (los tokens se perderán entre reinicios).
const keyHex = process.env.ENCRYPTION_KEY;
const KEY = keyHex ? Buffer.from(keyHex, 'hex') : crypto.randomBytes(32); 
const IV_LENGTH = 16;

class EncryptionService {
  /**
   * Cifra un texto plano usando AES-256-GCM
   * @param {string} text - Texto a cifrar
   * @returns {string} Texto cifrado con formato iv:authTag:encrypted
   */
  static encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Formato: iv:authTag:encryptedText
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Descifra un texto cifrado
   * @param {string} encryptedData - Texto cifrado con formato iv:authTag:encrypted
   * @returns {string} Texto plano
   */
  static decrypt(encryptedData) {
    if (!encryptedData) return encryptedData;
    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Formato cifrado inválido');
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

module.exports = EncryptionService;

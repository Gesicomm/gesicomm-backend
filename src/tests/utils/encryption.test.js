const { encrypt, decrypt } = require('../../utils/encryption');

describe('Encryption Utility', () => {
  beforeAll(() => {
    // 32-byte hex key para la prueba
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('debe cifrar y descifrar texto correctamente', () => {
    const secret = 'mi_super_secreto_pagopar_123';
    
    const encrypted = encrypt(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:encrypted

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('debe manejar nulos', () => {
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  it('debe tirar error si la llave cambia o es incorrecta al descifrar', () => {
    const secret = 'test';
    const encrypted = encrypt(secret);
    
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decrypt(encrypted)).toThrow(); // Auth tag validation will fail
    
    // Restaurar
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });
});

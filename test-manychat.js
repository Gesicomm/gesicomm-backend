const { Sequelize } = require('sequelize');
const crypto = require('crypto');
const axios = require('axios');

const keyHex = '3c76a2b67cbb8c25f180df5e45b263df8219d04edc5bb8d9ae6c935ff79f08f4';
const KEY = Buffer.from(keyHex, 'hex');

function decrypt(encryptedData) {
  if (!encryptedData) return encryptedData;
  const parts = encryptedData.split(':');
  if (parts.length !== 3) throw new Error('Formato cifrado inválido');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const sequelize = new Sequelize('gesicomm', 'gesicomm', 'gestionecommerce1!', {
  host: '127.0.0.1',
  port: 5434,
  dialect: 'postgres',
  logging: false
});

async function run() {
  try {
    const [rows] = await sequelize.query('SELECT * FROM automatization_hub.manychat_connections LIMIT 1;');
    if (!rows.length) return;
    const apiKey = decrypt(rows[0].api_key_encrypted);
    console.log('Manychat API Key decrypted successfully.');
    const res = await axios.get('https://api.manychat.com/fb/page/getInfo', {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    console.log('Manychat page info:', JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error('Error:', e.response?.data || e.message);
  } finally {
    sequelize.close();
  }
}
run();

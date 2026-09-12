'use strict';

require('dotenv').config();

const { R2Service } = require('../src/services/r2/r2.service');

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const key = '_system/tests/r2-connection-test.txt';
  const content = 'Gesicomm R2 connection test';

  await R2Service.uploadObject({
    key,
    body: Buffer.from(content, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'no-store',
    contentLength: Buffer.byteLength(content),
  });

  await R2Service.headObject(key);

  const object = await R2Service.getObject(key);
  const downloaded = await streamToString(object.Body);
  if (downloaded !== content) {
    throw new Error('R2 connection test failed: downloaded content mismatch');
  }

  const listed = await R2Service.listObjects('_system/tests/');
  if (!listed.some((item) => item.Key === key)) {
    throw new Error('R2 connection test failed: test object was not listed');
  }

  await R2Service.deleteObject(key);

  console.log('R2 connection test: SUCCESS');
}

main().catch((error) => {
  console.error(error.message || 'R2 connection test failed');
  process.exit(1);
});

'use strict';

const { S3Client } = require('@aws-sdk/client-s3');
const { getR2Config } = require('./r2.config');

let r2Client;

function createR2Client(env = process.env) {
  const config = getR2Config(env);

  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getR2Client() {
  if (!r2Client) {
    r2Client = createR2Client();
  }
  return r2Client;
}

function resetR2ClientForTests() {
  r2Client = null;
}

module.exports = {
  createR2Client,
  getR2Client,
  resetR2ClientForTests,
};

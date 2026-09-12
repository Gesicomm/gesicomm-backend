'use strict';

const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getR2Client } = require('./r2.client');
const { getR2Config, buildPublicUrl } = require('./r2.config');
const { normalizeR2Error } = require('./r2.errors');
const { logger } = require('../../utils/logger');

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function safeLogError(error, { operation, key } = {}) {
  logger.error({
    mensaje: 'R2 operation failed',
    operation,
    bucket: process.env.R2_BUCKET_NAME,
    key,
    errorCode: error.code || error.name,
  });
}

class R2Service {
  static get bucketName() {
    return getR2Config().bucketName;
  }

  static publicUrl(key) {
    return buildPublicUrl(key);
  }

  static async uploadObject({ key, body, contentType, cacheControl, contentLength }) {
    const operation = 'PutObject';
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        ContentLength: contentLength,
      });

      await getR2Client().send(command);
      return {
        key,
        bucket: this.bucketName,
        url: this.publicUrl(key),
      };
    } catch (error) {
      const normalized = normalizeR2Error(error, { operation, key });
      safeLogError(normalized, { operation, key });
      throw normalized;
    }
  }

  static async deleteObject(key) {
    const operation = 'DeleteObject';
    try {
      await getR2Client().send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
      return true;
    } catch (error) {
      const normalized = normalizeR2Error(error, { operation, key });
      safeLogError(normalized, { operation, key });
      throw normalized;
    }
  }

  static async headObject(key) {
    const operation = 'HeadObject';
    try {
      return await getR2Client().send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
    } catch (error) {
      const normalized = normalizeR2Error(error, { operation, key });
      safeLogError(normalized, { operation, key });
      throw normalized;
    }
  }

  static async getObject(key) {
    const operation = 'GetObject';
    try {
      return await getR2Client().send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
    } catch (error) {
      const normalized = normalizeR2Error(error, { operation, key });
      safeLogError(normalized, { operation, key });
      throw normalized;
    }
  }

  /** Pagina automáticamente — ListObjectsV2 devuelve como máximo 1000 objetos por página. */
  static async listObjects(prefix) {
    const operation = 'ListObjectsV2';
    const objects = [];
    let continuationToken;
    try {
      do {
        const result = await getR2Client().send(new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        objects.push(...(result.Contents || []));
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    } catch (error) {
      const normalized = normalizeR2Error(error, { operation, key: prefix });
      safeLogError(normalized, { operation, key: prefix });
      throw normalized;
    }
  }
}

module.exports = {
  R2Service,
  IMMUTABLE_CACHE_CONTROL,
};

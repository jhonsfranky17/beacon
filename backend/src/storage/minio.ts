import { Client } from "minio";
import { env } from "../config/env";
import { logger } from "../logger";

export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD,
});

/** Idempotent — safe to call on every startup. */
export async function ensureBucketExists(): Promise<void> {
  const exists = await minioClient.bucketExists(env.MINIO_BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(env.MINIO_BUCKET);
    logger.info(`Created MinIO bucket "${env.MINIO_BUCKET}"`);
  }
}

import { randomUUID } from "node:crypto";
import { minioClient } from "./minio";
import { env } from "../config/env";

export type PhotoKind = "empty-truck" | "loaded-truck";

/** Uploads a photo buffer to MinIO and returns its object key. */
export async function uploadPhoto(
  buffer: Buffer,
  mimeType: string,
  visitId: string,
  kind: PhotoKind,
): Promise<string> {
  const objectKey = `visits/${visitId}/${kind}/${randomUUID()}`;
  await minioClient.putObject(env.MINIO_BUCKET, objectKey, buffer, buffer.length, {
    "Content-Type": mimeType,
  });
  return objectKey;
}

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;

/** A short-lived, backend-signed URL — never a public bucket (build-spec §5.5). */
export function getPhotoSignedUrl(objectKey: string): Promise<string> {
  return minioClient.presignedGetObject(env.MINIO_BUCKET, objectKey, SIGNED_URL_EXPIRY_SECONDS);
}

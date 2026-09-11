import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/setup/dbUrls";

const redisBase = process.env.REDIS_URL ?? "redis://localhost:6379";
const testRedisUrl = `${redisBase.replace(/\/\d+$/, "")}/1`;

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: testRedisUrl,
      JWT_SECRET: "test-only-secret-do-not-use-in-prod",
      NODE_ENV: "test",
      MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? "localhost",
      MINIO_PORT: process.env.MINIO_PORT ?? "9000",
      MINIO_USE_SSL: process.env.MINIO_USE_SSL ?? "false",
      MINIO_ROOT_USER: process.env.MINIO_ROOT_USER ?? "beacon",
      MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD ?? "change-me-too",
      // Isolated from the dev bucket so tests never clobber real photos.
      MINIO_BUCKET: "beacon-test",
    },
    globalSetup: ["./tests/setup/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

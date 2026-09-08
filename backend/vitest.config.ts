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
    },
    globalSetup: ["./tests/setup/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});

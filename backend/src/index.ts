import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./logger";
import { ensureBucketExists } from "./storage/minio";

async function main(): Promise<void> {
  await ensureBucketExists();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Beacon backend listening on port ${env.PORT.toString()}`);
  });
}

main().catch((error: unknown) => {
  logger.error(error, "Failed to start server");
  process.exitCode = 1;
});

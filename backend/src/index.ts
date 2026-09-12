import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./logger";
import { ensureBucketExists } from "./storage/minio";
import { initSocket } from "./realtime/socket";
import { setIoInstance } from "./realtime/broadcast";

async function main(): Promise<void> {
  await ensureBucketExists();

  const app = createApp();
  const httpServer = createServer(app);
  setIoInstance(initSocket(httpServer));

  httpServer.listen(env.PORT, () => {
    logger.info(`Beacon backend listening on port ${env.PORT.toString()}`);
  });
}

main().catch((error: unknown) => {
  logger.error(error, "Failed to start server");
  process.exitCode = 1;
});

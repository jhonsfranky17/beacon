import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});

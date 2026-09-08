import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL } from "./dbUrls";

async function ensureTestDatabaseExists(): Promise<void> {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  try {
    const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
    const { rowCount } = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (rowCount === 0) {
      // CREATE DATABASE cannot be parameterized; dbName comes from our own
      // fixed test config, never from external input.
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await adminPool.end();
  }
}

async function runMigrations(): Promise<void> {
  const testPool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const db = drizzle(testPool);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  } finally {
    await testPool.end();
  }
}

export default async function globalSetup(): Promise<void> {
  await ensureTestDatabaseExists();
  await runMigrations();
}

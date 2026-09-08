const devDatabaseUrl =
  process.env.DATABASE_URL ?? "postgres://beacon:change-me@localhost:55432/beacon";

/** Used only to issue CREATE DATABASE, which requires connecting to an existing db. */
export const ADMIN_DATABASE_URL = devDatabaseUrl;

export const TEST_DATABASE_URL = devDatabaseUrl.replace(/\/[^/]+$/, "/beacon_test");

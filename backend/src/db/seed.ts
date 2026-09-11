import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { organizations, plants, users } from "./schema";
import { hashPassword } from "../auth/password";
import { env } from "../config/env";
import { logger } from "../logger";

const ORG_NAME = "Tube Products of India";
const PLANT_CODE = "TEST";

async function main(): Promise<void> {
  let [org] = await db.select().from(organizations).where(eq(organizations.name, ORG_NAME)).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({ name: ORG_NAME }).returning();
    logger.info("Created organization");
  } else {
    logger.info("Organization already exists, skipping");
  }
  if (!org) throw new Error("Failed to create or find organization");

  let [plant] = await db.select().from(plants).where(eq(plants.code, PLANT_CODE)).limit(1);
  if (!plant) {
    [plant] = await db
      .insert(plants)
      .values({
        organizationId: org.id,
        name: "Test Plant",
        code: PLANT_CODE,
        timezone: "Asia/Kolkata",
      })
      .returning();
    logger.info("Created test plant");
  } else {
    logger.info("Test plant already exists, skipping");
  }
  if (!plant) throw new Error("Failed to create or find test plant");

  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.phone, env.SEED_ADMIN_PHONE))
    .limit(1);

  if (existingAdmin) {
    logger.info("Corporate Admin already exists, skipping");
  } else {
    const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
    await db.insert(users).values({
      plantId: null,
      role: "CORPORATE_ADMIN",
      name: "Corporate Admin",
      phone: env.SEED_ADMIN_PHONE,
      passwordHash,
    });
    logger.info(
      `Created Corporate Admin (phone: ${env.SEED_ADMIN_PHONE}) — communicate the seed password out-of-band, do not commit it.`,
    );
  }

  await pool.end();
}

main().catch((error: unknown) => {
  logger.error(error, "Seed failed");
  process.exitCode = 1;
});

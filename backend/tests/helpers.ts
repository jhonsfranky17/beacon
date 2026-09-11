import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { organizations, plants, users } from "../src/db/schema";
import { hashPassword } from "../src/auth/password";
import type { UserRole } from "@beacon/shared";

export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      organizations, plants, gates, users, vehicles, vehicle_visits,
      visit_events, halting_rate_slabs, push_subscriptions,
      notification_logs, plant_access_codes
    RESTART IDENTITY CASCADE
  `);
}

export async function createOrgAndPlant(code: string): Promise<{ orgId: string; plantId: string }> {
  const [org] = await db.insert(organizations).values({ name: `Org ${code}` }).returning();
  if (!org) throw new Error("Failed to create test organization");

  const [plant] = await db
    .insert(plants)
    .values({ organizationId: org.id, name: `Plant ${code}`, code })
    .returning();
  if (!plant) throw new Error("Failed to create test plant");

  return { orgId: org.id, plantId: plant.id };
}

interface CreateUserInput {
  role: UserRole;
  plantId: string | null;
  phone: string;
  password: string;
  name?: string;
}

export async function createUser(input: CreateUserInput): Promise<{ id: string }> {
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      role: input.role,
      plantId: input.plantId,
      phone: input.phone,
      passwordHash,
      name: input.name ?? "Test User",
    })
    .returning();
  if (!user) throw new Error("Failed to create test user");
  return { id: user.id };
}

/** A real, minimal (1x1 transparent) PNG — valid enough for multer's image fileFilter and MinIO. */
export function tinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

import { z } from "zod";

/**
 * Named-account roles (build-spec §6). Viewer is intentionally excluded —
 * it has no User row, no login, and is gated by PlantAccessCode instead.
 */
export const userRoleSchema = z.enum([
  "SECURITY",
  "LOADING_OPERATOR",
  "LOGISTICS",
  "CORPORATE_ADMIN",
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const USER_ROLES = userRoleSchema.options;

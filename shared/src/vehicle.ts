/**
 * build-spec §5.1 — apply on every write and every lookup. Never store or
 * match on raw user input.
 */
export function normalizeVehicleNo(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

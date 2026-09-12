export function plantRoom(plantId: string): string {
  return `plant:${plantId}`;
}

/** CORPORATE_ADMIN sockets join this in addition to (not instead of) any plant room. */
export const ADMIN_ROOM = "admin";

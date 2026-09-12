import { resolveAuthUser } from "../auth/resolveUser";
import { asyncHandler } from "./asyncHandler";

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const authUser = await resolveAuthUser(token);
  if (!authUser) {
    res.status(401).json({ error: "Invalid, expired, or inactive account token" });
    return;
  }

  req.user = authUser;
  next();
});

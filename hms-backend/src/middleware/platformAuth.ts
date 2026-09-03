import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface PlatformAuthedRequest extends Request {
  platformAdmin?: { id: string; name: string };
}

/**
 * Deliberately a completely separate auth realm from tenant auth
 * (compare src/middleware/auth.ts). A platform token's payload shape
 * ({ platformAdminId, name, scope: "platform" }) has NO overlap with a
 * tenant token's shape ({ id, role, name, tenantId }) — there's no
 * "tenantId" field here at all, and tenant auth's requireAuth explicitly
 * rejects any token missing tenantId. So a platform token can never pass
 * as a tenant token, and vice versa, even by accident — not because of
 * a permission check, but because the two token shapes simply don't
 * satisfy each other's required fields.
 */
export function requirePlatformAuth(req: PlatformAuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      platformAdminId?: string;
      name?: string;
      scope?: string;
    };
    if (payload.scope !== "platform" || !payload.platformAdminId) {
      return res.status(401).json({ error: "Invalid or expired session, please log in again" });
    }
    req.platformAdmin = { id: payload.platformAdminId, name: payload.name || "" };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session, please log in again" });
  }
}

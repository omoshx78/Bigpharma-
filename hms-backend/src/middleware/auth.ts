import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  user?: { id: string; role: string; name: string; tenantId: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      id: string;
      role: string;
      name: string;
      tenantId: string;
    };
    if (!payload.tenantId) {
      // Should never happen with tokens issued by this server, but guards
      // against stale tokens signed before multi-tenancy existed.
      return res.status(401).json({ error: "Invalid or expired session, please log in again" });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session, please log in again" });
  }
}

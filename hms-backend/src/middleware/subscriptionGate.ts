import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";

const GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// Paths that must always remain reachable regardless of subscription
// state — a locked tenant still needs to be able to log in, sign up (N/A
// for existing tenants, but harmless), and above all pay to unlock.
const EXEMPT_PREFIXES = ["/health", "/auth/login", "/auth/signup", "/auth/me", "/billing"];

export type SubscriptionState = "ACTIVE" | "GRACE" | "LOCKED";

export function subscriptionStateFor(currentPeriodEnd: Date, now = new Date()): SubscriptionState {
  if (now <= currentPeriodEnd) return "ACTIVE";
  if (now.getTime() - currentPeriodEnd.getTime() <= GRACE_PERIOD_MS) return "GRACE";
  return "LOCKED";
}

/**
 * Soft-locks write access for a tenant whose subscription has lapsed
 * past its 2-day grace period: GET requests always pass through (the
 * pharmacy can still see everything — inventory, past sales, reports),
 * but any mutating request (POST/PATCH/PUT/DELETE) is rejected with 402
 * until the subscription is paid up, EXCEPT the billing endpoints
 * themselves, which must stay reachable so the tenant can actually pay.
 *
 * Deliberately computed live from Tenant.currentPeriodEnd on every
 * mutating request rather than cached on the JWT (tokens live up to
 * 12h, too stale to trust for this) or flipped by a background job
 * (extra infra we don't need — a date comparison is enough).
 */
export async function subscriptionGate(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next(); // let the route's own requireAuth produce the 401

  let tenantId: string | undefined;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET as string) as { tenantId?: string };
    tenantId = payload.tenantId;
  } catch {
    return next(); // invalid/expired token — let requireAuth reject it with its normal message
  }
  if (!tenantId) return next();

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currentPeriodEnd: true } });
  if (!tenant) return next();

  if (subscriptionStateFor(tenant.currentPeriodEnd) === "LOCKED") {
    return res.status(402).json({
      error: "This pharmacy's subscription payment is overdue. The account is read-only until payment is made — go to Billing to pay.",
      locked: true,
    });
  }

  next();
}

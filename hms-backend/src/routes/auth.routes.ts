import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { logAction } from "../utils/audit";

const router = Router();

function signToken(user: { id: string; role: string; name: string; tenantId: string }) {
  return (jwt.sign as any)(
    { id: user.id, role: user.role, name: user.name, tenantId: user.tenantId },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "pharmacy";
}

async function uniqueSlug(base: string) {
  let slug = base;
  let n = 1;
  // Small collision space in practice (business names rarely repeat
  // exactly), so a short linear probe is fine here.
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * POST /auth/signup — the self-service entry point for a new pharmacy
 * business. Creates a brand new, fully isolated Tenant plus its first
 * user (an ADMIN), and logs that admin straight in. No invite code or
 * approval step required — this is how independent businesses get their
 * own separate instance of the app.
 */
const signupSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  adminName: z.string().min(1, "Your name is required"),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { businessName, adminName, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  const slug = await uniqueSlug(slugify(businessName));
  const passwordHash = await bcrypt.hash(password, 12);

  const { tenant, user } = await prisma.$transaction(async (tx) => {
    const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3-day free trial
    const tenant = await tx.tenant.create({ data: { name: businessName, slug, currentPeriodEnd: trialEnd } });
    const user = await tx.user.create({
      data: { tenantId: tenant.id, name: adminName, email, passwordHash, role: "ADMIN" },
    });
    return { tenant, user };
  });

  await logAction({
    tenantId: tenant.id,
    userId: user.id,
    action: "tenant.signup",
    entityType: "Tenant",
    entityId: tenant.id,
    details: { businessName },
  });

  const token = signToken({ id: user.id, role: user.role, name: user.name, tenantId: tenant.id });
  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
  });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  if (!user || !user.active) return res.status(401).json({ error: "Invalid email or password" });
  if (!user.tenant.active) return res.status(403).json({ error: "This pharmacy's account has been deactivated" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken({ id: user.id, role: user.role, name: user.name, tenantId: user.tenantId });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAction({ tenantId: user.tenantId, userId: user.id, action: "auth.login", entityType: "User", entityId: user.id });

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
  });
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => res.json(req.user));

router.get("/users", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.user!.tenantId },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastLoginAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["ADMIN", "ORDER_TAKER", "CASHIER"]),
});

router.post("/users", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { name, email, password, role } = parsed.data;
  // Email is unique across the whole system (not just this tenant) since
  // login is by email alone with no tenant/workspace picker.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "A user with this email already exists" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { tenantId: req.user!.tenantId, name, email, passwordHash, role } });

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "user.created", entityType: "User", entityId: user.id, details: { name, email, role } });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "ORDER_TAKER", "CASHIER"]).optional(),
  active: z.boolean().optional(),
});

router.patch("/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (parsed.data.active === false && req.params.id === req.user!.id) {
    return res.status(400).json({ error: "You can't deactivate your own account" });
  }
  if (parsed.data.role && parsed.data.role !== "ADMIN" && req.params.id === req.user!.id) {
    return res.status(400).json({ error: "You can't change your own role away from admin" });
  }

  const isRemovingAdminRights = (parsed.data.role && parsed.data.role !== "ADMIN") || parsed.data.active === false;
  if (isRemovingAdminRights && target.role === "ADMIN" && target.active) {
    const otherActiveAdmins = await prisma.user.count({
      where: { tenantId: req.user!.tenantId, role: "ADMIN", active: true, id: { not: req.params.id } },
    });
    if (otherActiveAdmins === 0) {
      return res.status(400).json({ error: "This is the last active admin account — create another admin before changing this one" });
    }
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "user.updated", entityType: "User", entityId: user.id, details: parsed.data });
  res.json(user);
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(8, "Password must be at least 8 characters") });

router.post("/users/:id/reset-password", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "user.password_reset", entityType: "User", entityId: req.params.id });
  res.json({ ok: true });
});

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

router.patch("/me/password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changeOwnPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId: req.user!.tenantId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

router.get("/audit-logs", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const action = req.query.action as string | undefined;
  const logs = await prisma.auditLog.findMany({
    where: {
      tenantId: req.user!.tenantId,
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(logs);
});

export default router;

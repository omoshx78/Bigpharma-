import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db";
import { requirePlatformAuth, PlatformAuthedRequest } from "../middleware/platformAuth";
import { subscriptionStateFor } from "../middleware/subscriptionGate";
import { getRate } from "../utils/fx";

const router = Router();

const REPORTING_CURRENCY = process.env.PLATFORM_REPORTING_CURRENCY || "USD";

function signPlatformToken(admin: { id: string; name: string }) {
  return (jwt.sign as any)(
    { platformAdminId: admin.id, name: admin.name, scope: "platform" },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

function periodRange(period: string | undefined, fromStr: string | undefined, toStr: string | undefined): { gte: Date; lt: Date } | null {
  if (period === "custom" && fromStr && toStr) {
    const from = new Date(fromStr);
    const to = new Date(toStr);
    to.setDate(to.getDate() + 1); // inclusive of the "to" day
    return { gte: from, lt: to };
  }
  const now = new Date();
  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { gte: start, lt: end };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { gte: start, lt: end };
  }
  return null; // all-time
}

/** Converts an arbitrary-currency amount into REPORTING_CURRENCY using a live rate — approximate (today's rate, not the historical rate at payment time), fine for a summary total. */
async function toReportingCurrency(amount: number, currency: string): Promise<number> {
  if (currency === REPORTING_CURRENCY) return amount;
  const { rate } = await getRate(currency, REPORTING_CURRENCY);
  return amount * rate;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))];
  return lines.join("\n");
}

function sendCsv(res: import("express").Response, filename: string, rows: Record<string, unknown>[]) {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });

  const admin = await prisma.platformAdmin.findUnique({ where: { email: parsed.data.email } });
  if (!admin) return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  const token = signPlatformToken(admin);
  res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
});

router.get("/auth/me", requirePlatformAuth, (req: PlatformAuthedRequest, res) => res.json(req.platformAdmin));

// ---------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------

router.get("/tenants", requirePlatformAuth, async (req, res) => {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "desc" } });

  const withState = await Promise.all(
    tenants.map(async (t) => {
      const lastPayment = await prisma.subscriptionPayment.findFirst({
        where: { tenantId: t.id, status: "SUCCESSFUL" },
        orderBy: { paidAt: "desc" },
      });
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        active: t.active,
        createdAt: t.createdAt,
        currentPeriodEnd: t.currentPeriodEnd,
        state: subscriptionStateFor(t.currentPeriodEnd),
        amount: t.subscriptionAmount != null ? Number(t.subscriptionAmount) : undefined,
        currency: t.subscriptionCurrency || undefined,
        lastPaymentAt: lastPayment?.paidAt || null,
        lastPaymentProvider: lastPayment?.provider || null,
      };
    })
  );

  if (req.query.format === "csv") {
    return sendCsv(
      res,
      "tenants.csv",
      withState.map((t) => ({
        Name: t.name,
        Slug: t.slug,
        State: t.state,
        "Current Period End": t.currentPeriodEnd.toISOString(),
        "Last Payment": t.lastPaymentAt ? new Date(t.lastPaymentAt).toISOString() : "",
        Provider: t.lastPaymentProvider || "",
        "Signed Up": t.createdAt.toISOString(),
      }))
    );
  }

  res.json(withState);
});

router.get("/tenants/:id/payments", requirePlatformAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const payments = await prisma.subscriptionPayment.findMany({
    where: { tenantId: req.params.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, payments });
});

// ---------------------------------------------------------------------
// Payments ledger (across all tenants)
// ---------------------------------------------------------------------

router.get("/payments", requirePlatformAuth, async (req, res) => {
  const range = periodRange(req.query.period as string, req.query.from as string, req.query.to as string);

  const payments = await prisma.subscriptionPayment.findMany({
    where: { status: "SUCCESSFUL", ...(range ? { paidAt: { gte: range.gte, lt: range.lt } } : {}) },
    include: { tenant: { select: { name: true, slug: true } } },
    orderBy: { paidAt: "desc" },
  });

  if (req.query.format === "csv") {
    return sendCsv(
      res,
      "payments.csv",
      payments.map((p) => ({
        Tenant: p.tenant.name,
        Provider: p.provider,
        Amount: Number(p.amount),
        Currency: p.currency,
        "KES Charged": p.kesAmount != null ? Number(p.kesAmount) : "",
        "Paid At": p.paidAt ? new Date(p.paidAt).toISOString() : "",
        Reference: p.txRef,
      }))
    );
  }

  res.json(payments);
});

// ---------------------------------------------------------------------
// Platform expenses (the SaaS owner's own operating costs)
// ---------------------------------------------------------------------

router.get("/expenses", requirePlatformAuth, async (req, res) => {
  const range = periodRange(req.query.period as string, req.query.from as string, req.query.to as string);
  const expenses = await prisma.platformExpense.findMany({
    where: range ? { date: { gte: range.gte, lt: range.lt } } : {},
    orderBy: { date: "desc" },
  });

  if (req.query.format === "csv") {
    return sendCsv(
      res,
      "platform-expenses.csv",
      expenses.map((e) => ({ Date: e.date.toISOString().slice(0, 10), Category: e.category, Amount: Number(e.amount), Currency: e.currency, Vendor: e.vendor || "", Notes: e.notes || "" }))
    );
  }

  res.json({ expenses, total: expenses.reduce((s, e) => s + Number(e.amount), 0) });
});

const expenseSchema = z.object({
  date: z.string().datetime(),
  category: z.string().min(1),
  amount: z.number().min(0.01),
  currency: z.string().min(1).default(REPORTING_CURRENCY),
  vendor: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/expenses", requirePlatformAuth, async (req: PlatformAuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const expense = await prisma.platformExpense.create({
    data: { ...parsed.data, date: new Date(parsed.data.date), recordedById: req.platformAdmin!.id },
  });
  res.status(201).json(expense);
});

router.delete("/expenses/:id", requirePlatformAuth, async (req, res) => {
  const existing = await prisma.platformExpense.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });
  await prisma.platformExpense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------

router.get("/summary", requirePlatformAuth, async (req, res) => {
  const period = (req.query.period as string) || "month";
  const range = periodRange(period, req.query.from as string, req.query.to as string);

  const [tenants, paymentsInPeriod, expensesInPeriod] = await Promise.all([
    prisma.tenant.findMany(),
    prisma.subscriptionPayment.findMany({
      where: { status: "SUCCESSFUL", ...(range ? { paidAt: { gte: range.gte, lt: range.lt } } : {}) },
    }),
    prisma.platformExpense.findMany({ where: range ? { date: { gte: range.gte, lt: range.lt } } : {} }),
  ]);

  const tenantStates = tenants.map((t) => subscriptionStateFor(t.currentPeriodEnd));
  const active = tenantStates.filter((s) => s === "ACTIVE").length;
  const grace = tenantStates.filter((s) => s === "GRACE").length;
  const locked = tenantStates.filter((s) => s === "LOCKED").length;

  let revenue = 0;
  for (const p of paymentsInPeriod) {
    revenue += await toReportingCurrency(Number(p.amount), p.currency);
  }
  const expensesTotal = expensesInPeriod
    .filter((e) => e.currency === REPORTING_CURRENCY) // simple sum; mixed-currency expenses are rare enough to flag rather than silently convert
    .reduce((s, e) => s + Number(e.amount), 0);
  const otherCurrencyExpenseCount = expensesInPeriod.filter((e) => e.currency !== REPORTING_CURRENCY).length;

  res.json({
    period,
    reportingCurrency: REPORTING_CURRENCY,
    tenantCount: tenants.length,
    active,
    grace,
    locked,
    revenue,
    paymentCount: paymentsInPeriod.length,
    expenses: expensesTotal,
    otherCurrencyExpenseCount,
    net: revenue - expensesTotal,
  });
});

export default router;

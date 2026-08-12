import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { logAction } from "../utils/audit";

const router = Router();

function periodRange(period: string | undefined): { gte: Date; lt: Date } | null {
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
  return null;
}

router.get("/collections", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const tenantId = req.user!.tenantId;
  const range = periodRange(req.query.period as string);

  const cashPayments = await prisma.payment.findMany({
    where: { tenantId, method: "CASH", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
    include: { sale: { include: { billingItems: true } } },
    orderBy: { paidAt: "desc" },
  });

  const claimPayments = await prisma.claimPayment.findMany({
    where: { tenantId, ...(range ? { recordedAt: { gte: range.gte, lt: range.lt } } : {}) },
    include: { payment: { include: { sale: true } } },
    orderBy: { recordedAt: "desc" },
  });

  const cash = cashPayments.reduce((s, p) => s + p.sale.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0), 0);
  const insurance = claimPayments.reduce((s, cp) => s + Number(cp.amount), 0);

  const cashTransactions = cashPayments.map((p) => ({
    id: p.id,
    saleId: p.saleId,
    customerName: p.sale.customerName || "Walk-in",
    amount: p.sale.billingItems.reduce((s, i) => s + Number(i.amount), 0),
    paidAt: p.paidAt,
  }));

  const insuranceTransactions = claimPayments.map((cp) => ({
    id: cp.id,
    saleId: cp.payment.saleId,
    customerName: cp.payment.sale.customerName || "Walk-in",
    amount: Number(cp.amount),
    paidAt: cp.recordedAt,
    insuranceProvider: cp.payment.insuranceProvider,
    claimNo: cp.payment.claimNo,
  }));

  const byCategory: Record<string, number> = {};
  for (const p of cashPayments) {
    for (const item of p.sale.billingItems) {
      const cat = item.category || "Other";
      byCategory[cat] = (byCategory[cat] || 0) + Number(item.amount);
    }
  }

  res.json({
    period: req.query.period || "all",
    totalCollected: cash + insurance,
    cash,
    insurancePaid: insurance,
    byCategory,
    cashTransactions,
    insuranceTransactions,
  });
});

router.get("/claims", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const claims = await prisma.payment.findMany({
    where: { tenantId: req.user!.tenantId, method: "INSURANCE" },
    include: { sale: { include: { billingItems: true } } },
    orderBy: { claimSubmittedAt: "desc" },
  });

  const withTotals = claims.map((c) => {
    const amount = c.sale.billingItems.reduce((s, i) => s + Number(i.amount), 0);
    const amountPaid = Number(c.amountPaid);
    return { ...c, amount, amountPaid, remaining: Math.max(0, amount - amountPaid), customerName: c.sale.customerName || "Walk-in", saleNo: c.sale.saleNo };
  });

  const outstandingValue = withTotals.filter((c) => c.claimStatus !== "PAID" && c.claimStatus !== "REJECTED").reduce((s, c) => s + c.remaining, 0);
  res.json({ claims: withTotals, outstandingValue });
});

router.get("/insurance-providers", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const rows = await prisma.payment.findMany({
    where: { tenantId: req.user!.tenantId, method: "INSURANCE", insuranceProvider: { not: null } },
    select: { insuranceProvider: true },
    distinct: ["insuranceProvider"],
  });
  res.json(rows.map((r) => r.insuranceProvider).filter(Boolean).sort());
});

router.get("/insurance-by-provider", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const tenantId = req.user!.tenantId;
  const provider = req.query.provider as string | undefined;
  if (!provider) return res.status(400).json({ error: "A provider is required" });
  const range = periodRange(req.query.period as string);

  const claims = await prisma.payment.findMany({
    where: { tenantId, method: "INSURANCE", insuranceProvider: provider },
    include: { sale: { include: { billingItems: true } } },
    orderBy: { claimSubmittedAt: "desc" },
  });

  const claimsWithTotals = claims.map((c) => {
    const amount = c.sale.billingItems.reduce((s, i) => s + Number(i.amount), 0);
    const amountPaid = Number(c.amountPaid);
    return { id: c.id, saleId: c.saleId, customerName: c.sale.customerName || "Walk-in", claimNo: c.claimNo, claimStatus: c.claimStatus, amount, amountPaid, remaining: Math.max(0, amount - amountPaid) };
  });

  const pendingNow = claimsWithTotals.filter((c) => c.claimStatus !== "PAID" && c.claimStatus !== "REJECTED").reduce((s, c) => s + c.remaining, 0);

  const paymentsInPeriod = await prisma.claimPayment.findMany({
    where: { tenantId, payment: { insuranceProvider: provider }, ...(range ? { recordedAt: { gte: range.gte, lt: range.lt } } : {}) },
    include: { payment: { include: { sale: true } } },
    orderBy: { recordedAt: "desc" },
  });

  const paidInPeriod = paymentsInPeriod.reduce((s, p) => s + Number(p.amount), 0);
  const payments = paymentsInPeriod.map((p) => ({ id: p.id, customerName: p.payment.sale.customerName || "Walk-in", amount: Number(p.amount), recordedAt: p.recordedAt }));

  res.json({ provider, period: req.query.period || "all", paidInPeriod, pendingNow, claimCount: claims.length, claims: claimsWithTotals, payments });
});

router.get("/expenses", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const range = periodRange(req.query.period as string);
  const expenses = await prisma.expense.findMany({
    where: { tenantId: req.user!.tenantId, ...(range ? { date: { gte: range.gte, lt: range.lt } } : {}) },
    orderBy: { date: "desc" },
  });
  res.json({ expenses, total: expenses.reduce((s, e) => s + Number(e.amount), 0) });
});

const expenseSchema = z.object({
  date: z.string().datetime(),
  category: z.enum(["Stock procurement", "Salaries & wages", "Utilities", "Rent", "Transport", "Other"]),
  amount: z.number().min(0.01),
  vendor: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/expenses", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const expense = await prisma.expense.create({ data: { ...parsed.data, tenantId: req.user!.tenantId, date: new Date(parsed.data.date), recordedById: req.user!.id } });
  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "expense.recorded", entityType: "Expense", entityId: expense.id, details: { category: expense.category, amount: Number(expense.amount) } });
  res.status(201).json(expense);
});

router.delete("/expenses/:id", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const existing = await prisma.expense.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });
  await prisma.expense.delete({ where: { id: req.params.id } });
  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "expense.deleted", entityType: "Expense", entityId: req.params.id });
  res.json({ ok: true });
});

router.get("/summary", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const tenantId = req.user!.tenantId;
  const period = (req.query.period as string) || "today";
  const range = periodRange(period);

  const [cashPayments, claimPayments, expenses, outstandingClaims] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId, method: "CASH", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
      include: { sale: { include: { billingItems: true } } },
    }),
    prisma.claimPayment.findMany({ where: { tenantId, ...(range ? { recordedAt: { gte: range.gte, lt: range.lt } } : {}) } }),
    prisma.expense.findMany({ where: { tenantId, ...(range ? { date: { gte: range.gte, lt: range.lt } } : {}) } }),
    prisma.payment.findMany({
      where: { tenantId, method: "INSURANCE", claimStatus: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] } },
      include: { sale: { include: { billingItems: true } } },
    }),
  ]);

  const cash = cashPayments.reduce((s, p) => s + p.sale.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0), 0);
  const insurance = claimPayments.reduce((s, cp) => s + Number(cp.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const pendingClaims = outstandingClaims.reduce((s, c) => {
    const amount = c.sale.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0);
    return s + Math.max(0, amount - Number(c.amountPaid));
  }, 0);

  res.json({ period, totalCollected: cash + insurance, cash, insurancePaid: insurance, pendingClaims, totalExpenses, net: cash + insurance - totalExpenses });
});

export default router;

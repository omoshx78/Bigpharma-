import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { enqueue } from "../utils/workflow";
import { nextSaleNo } from "../utils/saleNo";
import { logAction } from "../utils/audit";

const router = Router();

async function requireClaimedEntry(tenantId: string, saleId: string, userId: string) {
  return prisma.queueEntry.findFirst({
    where: { tenantId, saleId, department: "CASHIER", status: "CLAIMED", claimedById: userId },
  });
}

const SALE_INCLUDE = {
  items: { include: { item: true } },
  billingItems: true,
  payment: { include: { installments: { orderBy: { recordedAt: "asc" as const } } } },
  notes: { orderBy: { createdAt: "asc" as const } },
};

/** GET /sales?search=name-phone-sale-number-or-item — for repeat customers, receipt lookup, and finding sales that included a given medicine */
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const search = (req.query.search as string) || "";
  const sales = await prisma.sale.findMany({
    where: {
      tenantId: req.user!.tenantId,
      ...(search
        ? {
            OR: [
              { saleNo: { contains: search, mode: "insensitive" } },
              { customerName: { contains: search, mode: "insensitive" } },
              { customerPhone: { contains: search } },
              { items: { some: { item: { name: { contains: search, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: SALE_INCLUDE,
  });
  res.json(sales);
});

router.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId }, include: SALE_INCLUDE });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  res.json(sale);
});

const createSaleSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) })).min(1, "Add at least one item"),
});

/**
 * POST /sales
 * The order-taker selects items and fulfills the order in one step (no
 * separate pharmacist hand-off, unlike the full DHS system) — stock is
 * decremented immediately and the sale goes straight into the shared
 * Cashier queue for payment.
 */
router.post("/", requireAuth, requireRole("ORDER_TAKER"), async (req: AuthedRequest, res) => {
  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { customerName, customerPhone, items } = parsed.data;
  const tenantId = req.user!.tenantId;

  const inventoryItems = await prisma.inventoryItem.findMany({ where: { tenantId, id: { in: items.map((i) => i.itemId) } } });
  if (inventoryItems.length !== items.length) {
    return res.status(400).json({ error: "One or more selected items don't exist in inventory" });
  }
  for (const line of items) {
    const stockItem = inventoryItems.find((i) => i.id === line.itemId)!;
    if (stockItem.quantity < line.quantity) {
      return res.status(409).json({ error: `Insufficient stock for ${stockItem.name} (have ${stockItem.quantity}, need ${line.quantity})` });
    }
  }

  const sale = await prisma.$transaction(async (tx) => {
    const saleNo = await nextSaleNo(tx, tenantId);
    const newSale = await tx.sale.create({
      data: { tenantId, saleNo, customerName: customerName || undefined, customerPhone: customerPhone || undefined, createdById: req.user!.id },
    });

    for (const line of items) {
      const stockItem = inventoryItems.find((i) => i.id === line.itemId)!;
      await tx.saleItem.create({
        data: { tenantId, saleId: newSale.id, itemId: line.itemId, quantity: line.quantity, unitPrice: stockItem.unitPrice },
      });
      await tx.inventoryItem.update({ where: { id: line.itemId }, data: { quantity: { decrement: line.quantity } } });
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          itemId: line.itemId,
          changeQty: -line.quantity,
          reason: "Sold",
          referenceType: "Sale",
          referenceId: newSale.id,
          createdById: req.user!.id,
        },
      });
      await tx.billingItem.create({
        data: {
          tenantId,
          saleId: newSale.id,
          description: `${stockItem.name} x${line.quantity}`,
          amount: Number(stockItem.unitPrice) * line.quantity,
          category: "Pharmacy",
        },
      });
    }

    await enqueue(tx, tenantId, newSale.id, "CASHIER");
    return newSale;
  });

  await logAction({ tenantId, userId: req.user!.id, action: "sale.created", entityType: "Sale", entityId: sale.id, details: { saleNo: sale.saleNo, items: items.length } });
  res.status(201).json(sale);
});

const noteSchema = z.object({ note: z.string().min(1) });

router.post("/:id/notes", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Note text is required" });

  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });

  const note = await prisma.saleNote.create({ data: { tenantId: req.user!.tenantId, saleId: req.params.id, authorId: req.user!.id, note: parsed.data.note } });
  res.status(201).json(note);
});

const addChargeSchema = z.object({ description: z.string().min(1), amount: z.number().min(0.01) });

router.post("/:id/billing-items", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = addChargeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const entry = await requireClaimedEntry(req.user!.tenantId, req.params.id, req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this sale from the cashier queue first" });

  const item = await prisma.billingItem.create({
    data: { tenantId: req.user!.tenantId, saleId: req.params.id, description: parsed.data.description, amount: parsed.data.amount, category: "Other" },
  });
  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "billing.charge_added", entityType: "BillingItem", entityId: item.id, details: parsed.data });
  res.status(201).json(item);
});

const paymentSchema = z.object({
  method: z.enum(["CASH", "INSURANCE"]),
  insuranceProvider: z.string().optional(),
  claimNo: z.string().optional(),
});

router.post("/:id/payment", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const saleId = req.params.id;
  const tenantId = req.user!.tenantId;
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { method, insuranceProvider, claimNo } = parsed.data;

  const entry = await requireClaimedEntry(tenantId, saleId, req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this sale from the cashier queue first" });

  const existingPayment = await prisma.payment.findFirst({ where: { saleId, tenantId } });
  if (existingPayment) return res.status(409).json({ error: "This sale was already paid — it should no longer be in the queue. Refresh the page." });

  const billingItems = await prisma.billingItem.findMany({ where: { saleId, tenantId } });
  const total = billingItems.reduce((s, i) => s + Number(i.amount), 0);
  const isInsurance = method === "INSURANCE";

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        tenantId,
        saleId,
        method,
        amount: total,
        amountPaid: isInsurance ? 0 : total,
        insuranceProvider: isInsurance ? insuranceProvider : undefined,
        claimNo: isInsurance ? claimNo : undefined,
        claimStatus: isInsurance ? "SUBMITTED" : undefined,
        claimSubmittedAt: isInsurance ? new Date() : undefined,
        paidAt: isInsurance ? undefined : new Date(),
        recordedById: req.user!.id,
      },
    });
    await tx.sale.update({ where: { id: saleId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    return p;
  });

  await logAction({
    tenantId,
    userId: req.user!.id,
    action: isInsurance ? "payment.claim_submitted" : "payment.cash_received",
    entityType: "Sale",
    entityId: saleId,
    details: { amount: total },
  });
  res.status(201).json(payment);
});

const claimStatusSchema = z.object({ status: z.enum(["SUBMITTED", "APPROVED", "PARTIALLY_PAID", "PAID", "REJECTED"]) });

router.patch("/:id/claim-status", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = claimStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid status" });

  const payment = await prisma.payment.findFirst({ where: { saleId: req.params.id, tenantId: req.user!.tenantId } });
  if (!payment) return res.status(404).json({ error: "No payment/claim found for this sale" });

  const updated = await prisma.payment.update({
    where: { saleId: req.params.id },
    data: { claimStatus: parsed.data.status, paidAt: parsed.data.status === "PAID" ? new Date() : null },
  });

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "claim.status_updated", entityType: "Payment", entityId: payment.id, details: { status: parsed.data.status } });
  res.json(updated);
});

const claimPaymentSchema = z.object({ amount: z.number().min(0.01), notes: z.string().optional() });

/** POST /sales/:id/claim-payments — record a partial/installment insurance payment */
router.post("/:id/claim-payments", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = claimPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const payment = await prisma.payment.findFirst({ where: { saleId: req.params.id, tenantId: req.user!.tenantId } });
  if (!payment) return res.status(404).json({ error: "No insurance claim found for this sale" });
  if (payment.method !== "INSURANCE") return res.status(400).json({ error: "This sale wasn't billed to insurance" });
  if (payment.claimStatus === "REJECTED") return res.status(400).json({ error: "This claim is marked rejected — change its status before recording a payment" });
  if (payment.claimStatus === "PAID") return res.status(400).json({ error: "This claim is already fully paid" });

  const remaining = Number(payment.amount) - Number(payment.amountPaid);
  if (parsed.data.amount > remaining + 0.01) {
    return res.status(400).json({ error: `That's more than the remaining balance of ${remaining.toFixed(2)}` });
  }

  const newAmountPaid = Number(payment.amountPaid) + parsed.data.amount;
  const fullyPaid = newAmountPaid >= Number(payment.amount) - 0.01;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.claimPayment.create({ data: { tenantId: req.user!.tenantId, paymentId: payment.id, amount: parsed.data.amount, recordedById: req.user!.id, notes: parsed.data.notes } });
    return tx.payment.update({
      where: { id: payment.id },
      data: { amountPaid: newAmountPaid, claimStatus: fullyPaid ? "PAID" : "PARTIALLY_PAID", paidAt: fullyPaid ? new Date() : payment.paidAt },
      include: { installments: { orderBy: { recordedAt: "asc" } } },
    });
  });

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "claim.payment_recorded", entityType: "Payment", entityId: payment.id, details: { amount: parsed.data.amount, fullyPaid } });
  res.status(201).json(updated);
});

/** POST /sales/:id/cancel — admin recovery for a stuck/mistaken sale */
router.post("/:id/cancel", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const tenantId = req.user!.tenantId;
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, tenantId }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  if (sale.status === "COMPLETED" || sale.status === "CANCELLED") {
    return res.status(400).json({ error: `This sale is already ${sale.status.toLowerCase()}` });
  }

  await prisma.$transaction(async (tx) => {
    // Restock whatever was taken out, since the sale never actually completed.
    for (const line of sale.items) {
      await tx.inventoryItem.update({ where: { id: line.itemId }, data: { quantity: { increment: line.quantity } } });
      await tx.inventoryTransaction.create({
        data: { tenantId, itemId: line.itemId, changeQty: line.quantity, reason: "Sale cancelled — restocked", referenceType: "Sale", referenceId: sale.id, createdById: req.user!.id },
      });
    }
    await tx.queueEntry.updateMany({ where: { saleId: sale.id, status: { in: ["WAITING", "CLAIMED"] } }, data: { status: "CANCELLED" } });
    await tx.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
  });

  await logAction({ tenantId, userId: req.user!.id, action: "sale.cancelled", entityType: "Sale", entityId: sale.id });
  res.json({ ok: true });
});

export default router;

import { Router } from "express";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { subscriptionStateFor } from "../middleware/subscriptionGate";
import {
  initiateSubscriptionPayment,
  verifyTransaction,
  isValidWebhookSignature,
  isBillingConfigured,
  SUBSCRIPTION_AMOUNT,
  SUBSCRIPTION_CURRENCY,
} from "../utils/flutterwave";
import { logAction } from "../utils/audit";

const router = Router();

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

router.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const state = subscriptionStateFor(tenant.currentPeriodEnd);
  res.json({
    state,
    currentPeriodEnd: tenant.currentPeriodEnd,
    amount: SUBSCRIPTION_AMOUNT,
    currency: SUBSCRIPTION_CURRENCY,
    billingConfigured: isBillingConfigured(),
  });
});

router.post("/checkout", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ error: "Subscription billing isn't configured yet — contact support." });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const adminUser = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId: tenant.id } });
  if (!adminUser) return res.status(404).json({ error: "User not found" });

  const txRef = `sub_${tenant.id}_${Date.now()}`;

  await prisma.subscriptionPayment.create({
    data: { tenantId: tenant.id, txRef, amount: SUBSCRIPTION_AMOUNT, currency: SUBSCRIPTION_CURRENCY, status: "PENDING" },
  });

  try {
    const link = await initiateSubscriptionPayment({
      txRef,
      customerEmail: adminUser.email,
      customerName: adminUser.name,
      tenantName: tenant.name,
    });
    res.json({ link });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not start checkout with Flutterwave" });
  }
});

/**
 * Applies a verified successful transaction: extends the tenant's
 * currentPeriodEnd by one month (from whichever is later — now, or
 * their existing period end, so paying early doesn't waste time) and
 * marks the ledger row paid. Idempotent — safe to call twice for the
 * same transaction (e.g. once from the redirect callback, once from the
 * webhook), since it checks the row hasn't already been marked paid.
 */
async function applySuccessfulPayment(tenantId: string, txRef: string, flwTransactionId: string) {
  const payment = await prisma.subscriptionPayment.findUnique({ where: { txRef } });
  if (!payment || payment.tenantId !== tenantId) return null;
  if (payment.status === "SUCCESSFUL") return payment; // already applied

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;

  const periodStart = tenant.currentPeriodEnd > new Date() ? tenant.currentPeriodEnd : new Date();
  const periodEnd = new Date(periodStart.getTime() + ONE_MONTH_MS);

  const [, updatedPayment] = await prisma.$transaction([
    prisma.tenant.update({ where: { id: tenantId }, data: { currentPeriodEnd: periodEnd } }),
    prisma.subscriptionPayment.update({
      where: { txRef },
      data: { status: "SUCCESSFUL", flwTransactionId, paidAt: new Date(), periodStart, periodEnd },
    }),
  ]);

  await logAction({ tenantId, action: "subscription.paid", entityType: "SubscriptionPayment", entityId: updatedPayment.id, details: { periodEnd } });
  return updatedPayment;
}

/**
 * GET /billing/callback — the browser lands here after Flutterwave
 * checkout. We NEVER trust the status/amount in these query params
 * directly (they're attacker-controllable in the URL) — we only use
 * transaction_id to look the transaction up server-to-server via
 * verifyTransaction before doing anything.
 */
router.get("/callback", async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  const transactionId = req.query.transaction_id as string | undefined;
  const txRef = req.query.tx_ref as string | undefined;

  if (!transactionId || !txRef) {
    return res.redirect(`${frontendUrl}/billing?paid=0`);
  }

  try {
    const verified = await verifyTransaction(transactionId);
    if (verified.status !== "successful" || verified.txRef !== txRef) {
      return res.redirect(`${frontendUrl}/billing?paid=0`);
    }
    if (Number(verified.amount) < SUBSCRIPTION_AMOUNT || verified.currency !== SUBSCRIPTION_CURRENCY) {
      return res.redirect(`${frontendUrl}/billing?paid=0`); // paid less than expected — don't grant access
    }

    const payment = await prisma.subscriptionPayment.findUnique({ where: { txRef } });
    if (!payment) return res.redirect(`${frontendUrl}/billing?paid=0`);

    await applySuccessfulPayment(payment.tenantId, txRef, verified.id);
    res.redirect(`${frontendUrl}/billing?paid=1`);
  } catch {
    res.redirect(`${frontendUrl}/billing?paid=0`);
  }
});

/**
 * POST /billing/webhook — the authoritative path. Unlike the redirect
 * callback (which depends on the customer's browser making it back),
 * Flutterwave calls this server-to-server, so it's the source of truth
 * even if the customer closes their browser mid-checkout.
 */
router.post("/webhook", async (req, res) => {
  if (!isValidWebhookSignature(req.headers["verif-hash"] as string | undefined)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const event = req.body;
  const txRef: string | undefined = event?.data?.tx_ref;
  const transactionId: string | undefined = event?.data?.id ? String(event.data.id) : undefined;

  if (event?.event !== "charge.completed" || !txRef || !transactionId) {
    return res.json({ ok: true }); // acknowledge, nothing to do
  }

  try {
    // Re-verify server-to-server rather than trusting the webhook
    // payload's own status field, per Flutterwave's own guidance.
    const verified = await verifyTransaction(transactionId);
    if (verified.status !== "successful" || verified.txRef !== txRef) return res.json({ ok: true });
    if (Number(verified.amount) < SUBSCRIPTION_AMOUNT || verified.currency !== SUBSCRIPTION_CURRENCY) return res.json({ ok: true });

    const payment = await prisma.subscriptionPayment.findUnique({ where: { txRef } });
    if (!payment) return res.json({ ok: true });

    await applySuccessfulPayment(payment.tenantId, txRef, verified.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export default router;

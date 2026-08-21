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
import {
  initiateStkPush,
  queryStkPushStatus,
  parseCallbackMetadata,
  normalizeKenyanPhone,
  isDarajaConfigured,
} from "../utils/daraja";
import { convertToKes } from "../utils/fx";
import { logAction } from "../utils/audit";

const router = Router();

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A tenant's effective price: their own override if set (via the
 * set-tenant-price script), otherwise the platform default from env
 * vars. This is the ONLY place that decides "what should this tenant
 * pay" — checkout, status, and payment verification all go through it,
 * so a price change here is guaranteed to apply consistently everywhere.
 */
function resolveTenantPrice(tenant: { subscriptionAmount: unknown; subscriptionCurrency: string | null }) {
  const amount = tenant.subscriptionAmount != null ? Number(tenant.subscriptionAmount) : SUBSCRIPTION_AMOUNT;
  const currency = tenant.subscriptionCurrency || SUBSCRIPTION_CURRENCY;
  return { amount, currency };
}

router.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const state = subscriptionStateFor(tenant.currentPeriodEnd);
  const { amount, currency } = resolveTenantPrice(tenant);
  res.json({
    state,
    currentPeriodEnd: tenant.currentPeriodEnd,
    amount,
    currency,
    billingConfigured: isBillingConfigured(),
    // M-Pesa is now offered regardless of the tenant's billing currency —
    // a non-KES price gets converted at checkout time (see
    // /billing/mpesa/quote and /billing/mpesa/checkout).
    mpesaAvailable: isDarajaConfigured(),
  });
});

/**
 * GET /billing/mpesa/quote — lets the frontend show "you'll pay
 * approximately KES X" before the customer commits to entering their
 * phone number. Purely informational: the actual STK Push amount is
 * always computed fresh at /mpesa/checkout time, so a slightly stale
 * quote here never causes a mismatch with what's actually charged or
 * verified.
 */
router.get("/mpesa/quote", requireAuth, async (req: AuthedRequest, res) => {
  if (!isDarajaConfigured()) return res.status(503).json({ error: "M-Pesa isn't configured yet." });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { amount, currency } = resolveTenantPrice(tenant);
  try {
    const { kesAmount, rate } = await convertToKes(amount, currency);
    res.json({ kesAmount, rate, originalAmount: amount, originalCurrency: currency });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not get a current exchange rate — try again shortly." });
  }
});

router.post("/checkout", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ error: "Subscription billing isn't configured yet — contact support." });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const adminUser = await prisma.user.findFirst({ where: { id: req.user!.id, tenantId: tenant.id } });
  if (!adminUser) return res.status(404).json({ error: "User not found" });

  const { amount, currency } = resolveTenantPrice(tenant);
  const txRef = `sub_${tenant.id}_${Date.now()}`;

  await prisma.subscriptionPayment.create({
    data: { tenantId: tenant.id, txRef, amount, currency, status: "PENDING" },
  });

  try {
    const link = await initiateSubscriptionPayment({
      txRef,
      amount,
      currency,
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
 * same transaction (e.g. once from a redirect callback, once from a
 * webhook, or once from a callback and once from a status poll), since
 * it checks the row hasn't already been marked paid. Provider-agnostic —
 * used by both the Flutterwave and Daraja paths.
 */
async function applySuccessfulPayment(
  tenantId: string,
  txRef: string,
  extra: { flwTransactionId?: string; mpesaReceiptNumber?: string }
) {
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
      data: { status: "SUCCESSFUL", paidAt: new Date(), periodStart, periodEnd, ...extra },
    }),
  ]);

  await logAction({ tenantId, action: "subscription.paid", entityType: "SubscriptionPayment", entityId: updatedPayment.id, details: { periodEnd, provider: payment.provider } });
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
    const payment = await prisma.subscriptionPayment.findUnique({ where: { txRef } });
    if (!payment) return res.redirect(`${frontendUrl}/billing?paid=0`);

    const verified = await verifyTransaction(transactionId);
    if (verified.status !== "successful" || verified.txRef !== txRef) {
      return res.redirect(`${frontendUrl}/billing?paid=0`);
    }
    // Check against THIS payment's own recorded price (resolved from the
    // tenant's override or the platform default at checkout time) — not
    // the global constant, so per-tenant pricing verifies correctly.
    if (Number(verified.amount) < Number(payment.amount) || verified.currency !== payment.currency) {
      return res.redirect(`${frontendUrl}/billing?paid=0`); // paid less than expected — don't grant access
    }

    await applySuccessfulPayment(payment.tenantId, txRef, { flwTransactionId: verified.id });
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
    const payment = await prisma.subscriptionPayment.findUnique({ where: { txRef } });
    if (!payment) return res.json({ ok: true });

    // Re-verify server-to-server rather than trusting the webhook
    // payload's own status field, per Flutterwave's own guidance.
    const verified = await verifyTransaction(transactionId);
    if (verified.status !== "successful" || verified.txRef !== txRef) return res.json({ ok: true });
    if (Number(verified.amount) < Number(payment.amount) || verified.currency !== payment.currency) return res.json({ ok: true });

    await applySuccessfulPayment(payment.tenantId, txRef, { flwTransactionId: verified.id });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * POST /billing/mpesa/checkout — initiates an STK Push: the customer
 * gets a prompt on their phone to enter their M-Pesa PIN. Unlike
 * Flutterwave's hosted checkout, there's no page to redirect to — the
 * frontend polls GET /billing/mpesa/status/:checkoutRequestId while the
 * customer completes the prompt on their phone.
 */
router.post("/mpesa/checkout", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  if (!isDarajaConfigured()) {
    return res.status(503).json({ error: "M-Pesa isn't configured yet — contact support." });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { amount, currency } = resolveTenantPrice(tenant);

  let kesAmount: number;
  let fxRate: number;
  try {
    const converted = await convertToKes(amount, currency);
    kesAmount = converted.kesAmount;
    fxRate = converted.rate;
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Could not get a current exchange rate — try again shortly, or pay by card instead." });
  }

  const phoneRaw = req.body?.phoneNumber;
  if (typeof phoneRaw !== "string" || !phoneRaw.trim()) {
    return res.status(400).json({ error: "A phone number is required" });
  }

  let phoneNumber: string;
  try {
    phoneNumber = normalizeKenyanPhone(phoneRaw);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid phone number" });
  }

  const txRef = `sub_mpesa_${tenant.id}_${Date.now()}`;

  try {
    const { merchantRequestId, checkoutRequestId } = await initiateStkPush({
      phoneNumber,
      amount: kesAmount,
      accountReference: tenant.slug,
      transactionDesc: `${tenant.name} subscription`,
    });

    // amount/currency here stay the tenant's REAL contractual price
    // (e.g. USD) — kesAmount/fxRate record what was actually charged via
    // M-Pesa, for reconciliation and for verifying this specific payment.
    await prisma.subscriptionPayment.create({
      data: {
        tenantId: tenant.id,
        provider: "DARAJA",
        txRef,
        amount,
        currency,
        kesAmount,
        fxRate,
        status: "PENDING",
        checkoutRequestId,
        merchantRequestId,
        phoneNumber,
      },
    });

    res.status(201).json({ checkoutRequestId, kesAmount, fxRate });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not start M-Pesa payment" });
  }
});

/**
 * POST /billing/mpesa/callback — Safaricom posts the STK Push result
 * here once the customer approves or cancels on their phone (or it times
 * out). Daraja has no signature scheme like Flutterwave's verif-hash, so
 * we never trust the callback body's ResultCode alone — we always
 * cross-check with an active query to Safaricom before crediting anything.
 */
router.post("/mpesa/callback", async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  const checkoutRequestId: string | undefined = stkCallback?.CheckoutRequestID;
  if (!checkoutRequestId) return res.json({ ok: true }); // acknowledge, malformed/irrelevant payload

  try {
    const payment = await prisma.subscriptionPayment.findUnique({ where: { checkoutRequestId } });
    if (!payment) return res.json({ ok: true });

    const verified = await queryStkPushStatus(checkoutRequestId);
    if (verified.resultCode !== "0") {
      if (payment.status === "PENDING") {
        await prisma.subscriptionPayment.update({ where: { checkoutRequestId }, data: { status: "FAILED" } });
      }
      return res.json({ ok: true });
    }

    const metadata = parseCallbackMetadata(stkCallback?.CallbackMetadata?.Item);
    const expectedKes = payment.kesAmount != null ? Number(payment.kesAmount) : Number(payment.amount);
    if (metadata.Amount == null || metadata.Amount < expectedKes) {
      return res.json({ ok: true }); // paid less than expected — don't grant access
    }

    await applySuccessfulPayment(payment.tenantId, payment.txRef, { mpesaReceiptNumber: metadata.MpesaReceiptNumber });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/**
 * GET /billing/mpesa/status/:checkoutRequestId — the frontend polls this
 * every few seconds after starting checkout. If Safaricom's callback
 * hasn't landed yet after a few seconds, this actively re-queries
 * Safaricom itself as a fallback, so a dropped/delayed callback doesn't
 * leave the customer stuck on "waiting" forever.
 */
router.get("/mpesa/status/:checkoutRequestId", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const payment = await prisma.subscriptionPayment.findFirst({
    where: { checkoutRequestId: req.params.checkoutRequestId, tenantId: req.user!.tenantId },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  if (payment.status !== "PENDING") {
    return res.json({ status: payment.status });
  }

  // Still pending after some time — proactively check with Safaricom
  // rather than waiting indefinitely for their callback.
  const pendingForMs = Date.now() - payment.createdAt.getTime();
  if (pendingForMs < 5000) {
    return res.json({ status: "PENDING" }); // give the customer a moment to approve on their phone first
  }

  try {
    const result = await queryStkPushStatus(req.params.checkoutRequestId);
    if (result.resultCode === "0") {
      // Successful per query, but we don't have CallbackMetadata here
      // (that only comes via the callback payload) — apply without a
      // receipt number; the callback, if/when it lands, is a no-op
      // thanks to applySuccessfulPayment's idempotency check.
      await applySuccessfulPayment(payment.tenantId, payment.txRef, {});
      return res.json({ status: "SUCCESSFUL" });
    }
    // Any other result code (cancelled, timed out, still processing) —
    // rather than guessing which specific codes mean "definitely
    // failed" vs "still in progress", stay PENDING and let the frontend's
    // own timeout (see Billing.tsx) give up gracefully after ~90s. Safer
    // than prematurely marking a still-processing payment as FAILED.
    return res.json({ status: "PENDING" });
  } catch {
    return res.json({ status: "PENDING" });
  }
});

export default router;

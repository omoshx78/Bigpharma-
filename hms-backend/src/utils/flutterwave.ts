/**
 * Thin wrapper around Flutterwave's v3 REST API for platform subscription
 * billing (card + M-Pesa via one integration). Keep all Flutterwave HTTP
 * calls in this one file so there's a single place to audit.
 *
 * Required env vars (set on Render, never commit or paste into chat):
 *   FLW_SECRET_KEY        — starts with FLWSECK_...
 *   FLW_WEBHOOK_SECRET_HASH — the "Secret Hash" you set in the Flutterwave
 *                             dashboard under Settings > Webhooks. We
 *                             compare this against the verif-hash header
 *                             on every incoming webhook.
 *   SUBSCRIPTION_AMOUNT   — e.g. "15" (defaults to 15 if unset)
 *   SUBSCRIPTION_CURRENCY — e.g. "USD" or "KES" (defaults to USD if unset)
 *   FRONTEND_URL           — e.g. https://bigpharma.vercel.app, used to
 *                             build the redirect_url Flutterwave sends
 *                             the browser back to after checkout.
 */

const FLW_BASE_URL = "https://api.flutterwave.com/v3";

export const SUBSCRIPTION_AMOUNT = Number(process.env.SUBSCRIPTION_AMOUNT || "15");
export const SUBSCRIPTION_CURRENCY = process.env.SUBSCRIPTION_CURRENCY || "USD";

function requireSecretKey(): string {
  const key = process.env.FLW_SECRET_KEY;
  if (!key) throw new Error("FLW_SECRET_KEY is not set — subscription billing is not configured yet.");
  return key;
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.FLW_SECRET_KEY);
}

interface InitiatePaymentParams {
  txRef: string;
  customerEmail: string;
  customerName: string;
  tenantName: string;
}

/**
 * Creates a Flutterwave Standard Checkout session — a hosted payment
 * page that itself offers card, M-Pesa, and other local payment methods
 * as tabs, so we don't need to build separate flows for each. Returns
 * the checkout URL to redirect the browser to.
 *
 * redirect_url points at THIS backend's own /billing/callback (not the
 * frontend) — that's where server-to-server verification happens before
 * the browser gets bounced onward to the frontend's /billing page. Set
 * API_BASE_URL to this backend's own public URL (e.g. the Render URL).
 */
export async function initiateSubscriptionPayment(params: InitiatePaymentParams): Promise<string> {
  const apiBaseUrl = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!apiBaseUrl) throw new Error("API_BASE_URL is not set — needed to build the payment redirect link.");

  const res = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireSecretKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      redirect_url: `${apiBaseUrl}/billing/callback`,
      customer: { email: params.customerEmail, name: params.customerName },
      customizations: { title: "DHS Pharmacy subscription", description: `Monthly subscription — ${params.tenantName}` },
    }),
  });

  const data = (await res.json()) as { status?: string; message?: string; data?: { link?: string } };
  if (!res.ok || data.status !== "success" || !data.data?.link) {
    throw new Error(data.message || "Flutterwave did not return a checkout link");
  }
  return data.data.link;
}

export interface VerifiedTransaction {
  id: string;
  txRef: string;
  status: string; // "successful" | "failed" | ...
  amount: number;
  currency: string;
}

/**
 * ALWAYS verify a transaction server-to-server before trusting it —
 * never trust the status/amount query params on the redirect callback
 * alone, since those are attacker-controllable in the browser URL.
 */
export async function verifyTransaction(transactionId: string): Promise<VerifiedTransaction> {
  const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${requireSecretKey()}` },
  });
  const data = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { id?: number | string; tx_ref?: string; status?: string; amount?: number; currency?: string };
  };
  if (!res.ok || data.status !== "success" || !data.data) {
    throw new Error(data.message || "Could not verify transaction with Flutterwave");
  }
  return {
    id: String(data.data.id),
    txRef: data.data.tx_ref ?? "",
    status: data.data.status ?? "",
    amount: Number(data.data.amount),
    currency: data.data.currency ?? "",
  };
}

export function isValidWebhookSignature(headerValue: string | undefined): boolean {
  const expected = process.env.FLW_WEBHOOK_SECRET_HASH;
  if (!expected || !headerValue) return false;
  // Constant-time-ish comparison isn't critical here (this is a shared
  // static secret, not a per-request HMAC), but a plain === is fine and
  // matches Flutterwave's own documented verification approach.
  return headerValue === expected;
}

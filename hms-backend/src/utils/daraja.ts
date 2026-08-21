/**
 * Thin wrapper around Safaricom's Daraja API (STK Push) — a second,
 * independent M-Pesa path alongside Flutterwave's own M-Pesa flow. Keep
 * all Daraja HTTP calls in this one file, same pattern as flutterwave.ts.
 *
 * Required env vars (set on Render, never commit or paste into chat):
 *   DARAJA_ENV               — "sandbox" or "production" (defaults to sandbox)
 *   DARAJA_CONSUMER_KEY
 *   DARAJA_CONSUMER_SECRET
 *   DARAJA_SHORTCODE         — your Paybill or Till number
 *   DARAJA_PASSKEY           — the Lipa na M-Pesa Online passkey Safaricom
 *                               issued alongside your shortcode
 *   DARAJA_TRANSACTION_TYPE  — "CustomerPayBillOnline" (default, for a
 *                               Paybill) or "CustomerBuyGoodsOnline" (for
 *                               a Till number) — set this explicitly if
 *                               you're using a Till.
 *   API_BASE_URL              — reused from flutterwave.ts; STK Push
 *                               callback URL is built from this too:
 *                               {API_BASE_URL}/billing/mpesa/callback
 */

function baseUrl(): string {
  return process.env.DARAJA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

export function isDarajaConfigured(): boolean {
  return Boolean(
    process.env.DARAJA_CONSUMER_KEY &&
      process.env.DARAJA_CONSUMER_SECRET &&
      process.env.DARAJA_SHORTCODE &&
      process.env.DARAJA_PASSKEY
  );
}

function requireConfig() {
  const { DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY } = process.env;
  if (!DARAJA_CONSUMER_KEY || !DARAJA_CONSUMER_SECRET || !DARAJA_SHORTCODE || !DARAJA_PASSKEY) {
    throw new Error("M-Pesa (Daraja) isn't configured yet — contact support.");
  }
  return { key: DARAJA_CONSUMER_KEY, secret: DARAJA_CONSUMER_SECRET, shortcode: DARAJA_SHORTCODE, passkey: DARAJA_PASSKEY };
}

// OAuth tokens are valid ~1 hour; cache in memory rather than fetching one
// per request. Fine for a single backend instance — if you later scale to
// multiple instances, each just gets its own cache, which is harmless
// (just a few extra token requests, well within Safaricom's rate limits).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const { key, secret } = requireConfig();
  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Could not authenticate with Safaricom Daraja");
  }
  // Refresh a little early (50 min) rather than cutting it exactly at 1hr.
  cachedToken = { token: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return data.access_token;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Normalizes a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX
 * format Daraja requires. Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX,
 * 2547XXXXXXXX, or with spaces/dashes.
 */
export function normalizeKenyanPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`; // e.g. 712345678 with no leading 0
  throw new Error("That doesn't look like a valid Kenyan phone number (expected format: 07XXXXXXXX)");
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
}

export async function initiateStkPush(params: {
  phoneNumber: string; // already normalized via normalizeKenyanPhone
  amount: number;
  accountReference: string; // shows on the customer's phone
  transactionDesc: string;
}): Promise<StkPushResult> {
  const { shortcode, passkey } = requireConfig();
  const apiBaseUrl = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
  if (!apiBaseUrl) throw new Error("API_BASE_URL is not set — needed to build the M-Pesa callback URL.");

  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
  const transactionType = process.env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline";

  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: transactionType,
      Amount: Math.round(params.amount), // M-Pesa only accepts whole-shilling amounts
      PartyA: params.phoneNumber,
      PartyB: shortcode,
      PhoneNumber: params.phoneNumber,
      CallBackURL: `${apiBaseUrl}/billing/mpesa/callback`,
      AccountReference: params.accountReference,
      TransactionDesc: params.transactionDesc,
    }),
  });

  const data = (await res.json()) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    errorMessage?: string;
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
  };

  if (!res.ok || data.ResponseCode !== "0" || !data.CheckoutRequestID || !data.MerchantRequestID) {
    throw new Error(data.errorMessage || data.ResponseDescription || "Safaricom did not accept the STK Push request");
  }
  return { merchantRequestId: data.MerchantRequestID, checkoutRequestId: data.CheckoutRequestID };
}

export interface StkPushQueryResult {
  resultCode: string; // "0" = success
  resultDesc: string;
}

/**
 * Actively asks Safaricom for the outcome of an STK Push, rather than
 * only waiting on their callback — used both as the authoritative check
 * when the callback DOES arrive (never trust the callback body alone)
 * and as a fallback poll target if the callback is delayed or dropped.
 */
export async function queryStkPushStatus(checkoutRequestId: string): Promise<StkPushQueryResult> {
  const { shortcode, passkey } = requireConfig();
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");

  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const data = (await res.json()) as { ResultCode?: string; ResultDesc?: string; errorMessage?: string };
  if (!res.ok) throw new Error(data.errorMessage || "Could not query M-Pesa transaction status");
  return { resultCode: String(data.ResultCode ?? ""), resultDesc: data.ResultDesc || "" };
}

export interface StkCallbackItem {
  Amount?: number;
  MpesaReceiptNumber?: string;
  PhoneNumber?: number;
  TransactionDate?: number;
}

/** Extracts the flat fields out of Safaricom's nested CallbackMetadata.Item array shape. */
export function parseCallbackMetadata(items: { Name: string; Value?: string | number }[] | undefined): StkCallbackItem {
  const out: StkCallbackItem = {};
  for (const item of items || []) {
    if (item.Name === "Amount") out.Amount = Number(item.Value);
    if (item.Name === "MpesaReceiptNumber") out.MpesaReceiptNumber = String(item.Value);
    if (item.Name === "PhoneNumber") out.PhoneNumber = Number(item.Value);
    if (item.Name === "TransactionDate") out.TransactionDate = Number(item.Value);
  }
  return out;
}

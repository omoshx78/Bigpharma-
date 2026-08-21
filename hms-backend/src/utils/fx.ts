/**
 * Live currency conversion, used only for one thing: letting a tenant
 * whose subscription is priced in USD (or any non-KES currency) still
 * pay via M-Pesa, which only ever settles in KES. The tenant's actual
 * contractual price stays exactly as stored (e.g. USD) — conversion
 * happens only at the moment of an M-Pesa checkout, and the resulting
 * KES amount is recorded on that SubscriptionPayment row for audit.
 *
 * Optional env vars:
 *   FX_MARKUP_PERCENT     — e.g. "2" adds 2% on top of the live rate, to
 *                            cover rate slippage between quote and actual
 *                            charge. Defaults to 0 (no markup).
 *   FX_FALLBACK_USD_KES   — a manually-set rate used ONLY if the live
 *                            rate lookup fails (e.g. the FX API is down).
 *                            Leave unset to fail cleanly instead — that's
 *                            the safer default for a real-money feature.
 */

const FX_API_URL = "https://open.er-api.com/v6/latest";
const CACHE_TTL_MS = 10 * 60 * 1000; // rates don't need to be fetched more often than every 10 min

const rateCache = new Map<string, { rate: number; fetchedAt: number }>();

export interface RateQuote {
  rate: number; // 1 unit of `from` = `rate` units of `to`, including markup
  rawRate: number; // the unmarked-up rate actually returned by the FX provider
  fetchedAt: Date;
}

async function fetchLiveRate(from: string, to: string): Promise<number> {
  const res = await fetch(`${FX_API_URL}/${from}`);
  const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (data.result !== "success" || !data.rates?.[to]) {
    throw new Error(`Could not get a live ${from}->${to} exchange rate`);
  }
  return data.rates[to];
}

export async function getRate(from: string, to: string): Promise<RateQuote> {
  if (from === to) return { rate: 1, rawRate: 1, fetchedAt: new Date() };

  const cacheKey = `${from}_${to}`;
  const cached = rateCache.get(cacheKey);
  let rawRate: number;

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    rawRate = cached.rate;
  } else {
    try {
      rawRate = await fetchLiveRate(from, to);
      rateCache.set(cacheKey, { rate: rawRate, fetchedAt: Date.now() });
    } catch (err) {
      const fallback = Number(process.env.FX_FALLBACK_USD_KES);
      if (from === "USD" && to === "KES" && !Number.isNaN(fallback) && fallback > 0) {
        rawRate = fallback;
      } else {
        throw err;
      }
    }
  }

  const markupPercent = Number(process.env.FX_MARKUP_PERCENT || "0") || 0;
  const rate = rawRate * (1 + markupPercent / 100);
  return { rate, rawRate, fetchedAt: new Date() };
}

/** Converts an amount and rounds to the nearest whole unit — required for KES, since M-Pesa doesn't accept fractional shillings. */
export async function convertToKes(amount: number, fromCurrency: string): Promise<{ kesAmount: number; rate: number }> {
  if (fromCurrency === "KES") return { kesAmount: Math.round(amount), rate: 1 };
  const quote = await getRate(fromCurrency, "KES");
  return { kesAmount: Math.round(amount * quote.rate), rate: quote.rate };
}

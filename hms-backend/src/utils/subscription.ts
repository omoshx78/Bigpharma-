const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A tenant's effective price: their own override if set (via the
 * set-tenant-price script or the Super Admin's tenant detail page),
 * otherwise the given platform default. This is the ONLY place that
 * decides "what should this tenant pay" — checkout, status, and payment
 * verification (billing.routes.ts) plus the Super Admin dashboard
 * (platform.routes.ts) all go through it, so a price change here is
 * guaranteed to apply consistently everywhere.
 */
export function resolveTenantPrice(
  tenant: { subscriptionAmount: unknown; subscriptionCurrency: string | null },
  platformDefaultAmount: number,
  platformDefaultCurrency: string
) {
  const amount = tenant.subscriptionAmount != null ? Number(tenant.subscriptionAmount) : platformDefaultAmount;
  const currency = tenant.subscriptionCurrency || platformDefaultCurrency;
  return { amount, currency };
}

/**
 * Computes the new period start/end for extending a tenant's
 * subscription by `days`, starting from whichever is later: now, or
 * their existing period end (so paying early doesn't waste time already
 * paid for). Pure function — doesn't touch the database. The caller
 * decides how to apply it (usually inside a $transaction alongside a
 * SubscriptionPayment write, see applySuccessfulPayment in
 * billing.routes.ts and the manual-payment route in platform.routes.ts).
 */
export function computeExtendedPeriod(currentPeriodEnd: Date, days: number, now = new Date()) {
  const periodStart = currentPeriodEnd > now ? currentPeriodEnd : now;
  const periodEnd = new Date(periodStart.getTime() + days * DAY_MS);
  return { periodStart, periodEnd };
}

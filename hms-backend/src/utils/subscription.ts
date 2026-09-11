const DAY_MS = 24 * 60 * 60 * 1000;

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

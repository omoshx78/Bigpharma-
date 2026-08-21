import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sets (or clears) a per-tenant subscription price override. Deliberately
 * NOT exposed anywhere in the app UI or API — pricing is a
 * platform-operator decision, not something a tenant's own ADMIN account
 * should be able to touch (they could just set it to 0). Run this
 * directly via Render Shell.
 *
 * Set a custom price:
 *   TENANT_SLUG=bigpharma AMOUNT=20 CURRENCY=USD npm run billing:set-price
 *
 * Clear an override (tenant falls back to the platform default —
 * SUBSCRIPTION_AMOUNT / SUBSCRIPTION_CURRENCY env vars):
 *   TENANT_SLUG=bigpharma CLEAR=true npm run billing:set-price
 *
 * Only affects future payments — it does NOT retroactively adjust a
 * subscription period the tenant has already paid for.
 */
async function main() {
  const slug = process.env.TENANT_SLUG || process.argv[2];
  if (!slug) {
    console.error("Usage: TENANT_SLUG=<slug> AMOUNT=<number> CURRENCY=<code> npm run billing:set-price");
    console.error("   or: TENANT_SLUG=<slug> CLEAR=true npm run billing:set-price   (revert to platform default)");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    console.error(`No tenant found with slug "${slug}". Existing tenants:`);
    for (const t of all) console.error(`  - ${t.slug} (${t.name})`);
    process.exit(1);
  }

  if (process.env.CLEAR === "true") {
    await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionAmount: null, subscriptionCurrency: null } });
    console.log(`Cleared price override for ${tenant.name} (${tenant.slug}) — now uses the platform default.`);
    return;
  }

  const amountStr = process.env.AMOUNT;
  const currency = process.env.CURRENCY;
  const amount = amountStr ? Number(amountStr) : NaN;

  if (!amountStr || Number.isNaN(amount) || amount <= 0 || !currency) {
    console.error("Provide both AMOUNT (a positive number) and CURRENCY (e.g. USD, KES), or CLEAR=true to remove an override.");
    process.exit(1);
  }

  await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionAmount: amount, subscriptionCurrency: currency.toUpperCase() } });
  console.log(`Set ${tenant.name} (${tenant.slug}) to ${currency.toUpperCase()} ${amount}/month.`);
  console.log("This applies to their NEXT payment — it does not change a period they've already paid for.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

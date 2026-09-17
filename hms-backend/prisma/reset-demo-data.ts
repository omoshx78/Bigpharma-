import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEMO_INVENTORY } from "./demoInventoryBaseline";

const prisma = new PrismaClient();

/**
 * Wipes all transactional data (sales, queue entries, expenses, audit
 * log) for the public demo tenant and resets every inventory item's
 * quantity back to its seeded baseline. Needed because the demo uses
 * one shared, publicly-known login — anyone exploring it can create
 * sales, adjust stock, add expenses, etc., and without a periodic reset
 * the demo would get messier for every subsequent visitor over time.
 *
 * The Tenant, its admin User, and the InventoryItem rows themselves are
 * NOT deleted — only their transactional history and quantities reset,
 * so this is fast and safe to run often.
 *
 * Usage: npm run demo:reset
 *
 * To automate this (recommended — e.g. nightly), wire it to Render's
 * Cron Jobs feature once you're on a plan that supports it: a scheduled
 * job running `npm run demo:reset` against this same service.
 */
async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { isDemo: true } });
  if (!tenant) {
    console.error('No demo tenant found (isDemo: true). Run "npm run seed" first.');
    process.exit(1);
  }

  const saleIds = (await prisma.sale.findMany({ where: { tenantId: tenant.id }, select: { id: true } })).map((s) => s.id);

  await prisma.$transaction([
    prisma.claimPayment.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.payment.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.saleNote.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.billingItem.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.saleItem.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.queueEntry.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.sale.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.inventoryTransaction.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.expense.deleteMany({ where: { tenantId: tenant.id } }),
    prisma.auditLog.deleteMany({ where: { tenantId: tenant.id } }),
  ]);

  for (const baseline of DEMO_INVENTORY) {
    await prisma.inventoryItem.updateMany({
      where: { tenantId: tenant.id, name: baseline.name },
      data: { quantity: baseline.quantity, unitPrice: baseline.unitPrice, reorderLevel: baseline.reorderLevel },
    });
  }

  // Remove any items a visitor added beyond the baseline list, and
  // re-add any baseline items a visitor deleted.
  const baselineNames = new Set(DEMO_INVENTORY.map((i) => i.name));
  const currentItems = await prisma.inventoryItem.findMany({ where: { tenantId: tenant.id } });
  const extras = currentItems.filter((i) => !baselineNames.has(i.name));
  if (extras.length > 0) {
    await prisma.inventoryItem.deleteMany({ where: { id: { in: extras.map((i) => i.id) } } });
  }
  const existingNames = new Set(currentItems.map((i) => i.name));
  for (const baseline of DEMO_INVENTORY) {
    if (!existingNames.has(baseline.name)) {
      await prisma.inventoryItem.create({ data: { ...baseline, tenantId: tenant.id } });
    }
  }

  console.log(`Reset demo tenant "${tenant.name}": cleared ${saleIds.length} sale(s), restored ${DEMO_INVENTORY.length} baseline item(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

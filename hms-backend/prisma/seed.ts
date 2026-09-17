import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { DEMO_INVENTORY } from "./demoInventoryBaseline";

const prisma = new PrismaClient();

/**
 * Seeds one public DEMO tenant with fixed, publicly-shared credentials —
 * meant to be linked from the landing page so a prospective customer can
 * explore the app before signing up. isDemo: true exempts it from ever
 * soft-locking for non-payment (see subscriptionGate.ts) regardless of
 * currentPeriodEnd, and excludes it from the Super Admin dashboard's
 * revenue/tenant-count figures (see platform.routes.ts).
 *
 * Safe to re-run: idempotently makes sure isDemo/currentPeriodEnd are
 * set correctly even if this tenant already existed from before this
 * flag existed, rather than only doing anything on first creation.
 *
 * In production, real pharmacies create their own tenant via
 * POST /auth/signup (or the Sign Up page) — this script is not part of
 * that flow and doesn't need to run there.
 */
async function main() {
  const slug = "demo-pharmacy";
  const adminEmail = "demo@dhspharmacy.com";
  const demoPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // belt-and-suspenders alongside isDemo, kept far out

  let tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: "Demo Pharmacy", slug, currentPeriodEnd: demoPeriodEnd, isDemo: true },
    });
    console.log(`Created demo tenant: ${tenant.name} (${tenant.slug})`);
  } else if (!tenant.isDemo) {
    tenant = await prisma.tenant.update({ where: { id: tenant.id }, data: { isDemo: true, currentPeriodEnd: demoPeriodEnd } });
    console.log(`Marked existing tenant "${tenant.slug}" as isDemo (was created before this flag existed).`);
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Demo Account",
        email: adminEmail,
        passwordHash: await bcrypt.hash("TryDHSPharmacy!", 12),
        role: "ADMIN",
      },
    });
    console.log(`Created demo login: ${adminEmail} / TryDHSPharmacy! — these are meant to be PUBLIC, link them from the landing page.`);
  }

  for (const item of DEMO_INVENTORY) {
    const existing = await prisma.inventoryItem.findFirst({ where: { tenantId: tenant.id, name: item.name } });
    if (!existing) await prisma.inventoryItem.create({ data: { ...item, tenantId: tenant.id } });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

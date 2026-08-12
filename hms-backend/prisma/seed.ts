import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

/**
 * Seeds one demo tenant for local development/testing so there's
 * something to log into right away. In production, real pharmacies
 * create their own tenant via POST /auth/signup (or the Sign Up page) —
 * this script is not part of that flow and doesn't need to run there.
 */
async function main() {
  const slug = "demo-pharmacy";
  const adminEmail = "admin@dhspharmacy.local";

  let tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: "Demo Pharmacy", slug } });
    console.log(`Created demo tenant: ${tenant.name} (${tenant.slug})`);
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "System Administrator",
        email: adminEmail,
        passwordHash: await bcrypt.hash("ChangeMe123!", 12),
        role: "ADMIN",
      },
    });
    console.log(`Created admin user: ${adminEmail} / ChangeMe123! — change this immediately.`);
  }

  const inventory = [
    { name: "Paracetamol 500mg", category: "Medicine", unit: "tablet", quantity: 480, reorderLevel: 100, unitPrice: 5 },
    { name: "Amoxicillin 500mg", category: "Medicine", unit: "capsule", quantity: 220, reorderLevel: 80, unitPrice: 15 },
    { name: "Artemether/Lumefantrine", category: "Medicine", unit: "pack", quantity: 60, reorderLevel: 40, unitPrice: 150 },
    { name: "ORS Sachets", category: "Medicine", unit: "sachet", quantity: 150, reorderLevel: 50, unitPrice: 20 },
    { name: "Ibuprofen 400mg", category: "Medicine", unit: "tablet", quantity: 90, reorderLevel: 100, unitPrice: 8 },
    { name: "Metformin 500mg", category: "Medicine", unit: "tablet", quantity: 300, reorderLevel: 100, unitPrice: 8 },
    { name: "Diazepam 5mg", category: "Medicine", unit: "tablet", quantity: 40, reorderLevel: 30, unitPrice: 15 },
    { name: "Ceftriaxone Injection 1g", category: "Medicine", unit: "vial", quantity: 25, reorderLevel: 20, unitPrice: 120 },
    { name: "Surgical Gloves (box)", category: "Consumable", unit: "box", quantity: 35, reorderLevel: 15, unitPrice: 300 },
    { name: "Syringes 5ml", category: "Consumable", unit: "piece", quantity: 300, reorderLevel: 100, unitPrice: 5 },
  ];
  for (const item of inventory) {
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

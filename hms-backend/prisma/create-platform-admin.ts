import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

/**
 * Creates a platform admin account (the SaaS owner's own login — sits
 * above every tenant, sees every tenant's billing state). There is no
 * public signup for this on purpose; only run this yourself via Render
 * Shell.
 *
 * Usage:
 *   NAME="Robinson Owino" EMAIL=owner@dhspharmacy.com PASSWORD='...' npm run platform:create-admin
 */
async function main() {
  const name = process.env.NAME;
  const email = process.env.EMAIL;
  const password = process.env.PASSWORD;

  if (!name || !email || !password) {
    console.error('Usage: NAME="..." EMAIL=... PASSWORD=... npm run platform:create-admin');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.error(`A platform admin with email ${email} already exists (id: ${existing.id}). Nothing created.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.platformAdmin.create({ data: { name, email, passwordHash } });
  console.log(`Created platform admin: ${admin.name} <${admin.email}> (id: ${admin.id})`);
  console.log("Log in at /platform/login on the frontend.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

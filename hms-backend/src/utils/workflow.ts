import { Department, PrismaClient } from "@prisma/client";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Puts a sale into a department's shared queue as WAITING, unless it's
 * already actively sitting there. Currently only "CASHIER" is used, but
 * this stays generic so a second stage (e.g. splitting order-taking from
 * dispensing) can be added later without touching this function.
 */
export async function enqueue(tx: TxClient, tenantId: string, saleId: string, department: Department) {
  const existingActive = await tx.queueEntry.findFirst({
    where: { tenantId, saleId, department, status: { in: ["WAITING", "CLAIMED"] } },
  });
  if (existingActive) return existingActive;

  return tx.queueEntry.create({
    data: { tenantId, saleId, department, status: "WAITING" },
  });
}

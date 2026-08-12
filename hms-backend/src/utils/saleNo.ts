import { Prisma } from "@prisma/client";

type TxClient = Omit<Prisma.TransactionClient, "$transaction">;

/**
 * Generates the next human-friendly sale number for a tenant, e.g.
 * "SALE-1042". Scoped per-tenant (not a shared global sequence) so
 * numbering is predictable for each business and never leaks how many
 * sales other tenants have made. Must be called inside the same
 * transaction that creates the Sale row, since it atomically increments
 * Tenant.saleCounter.
 */
export async function nextSaleNo(tx: TxClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.update({
    where: { id: tenantId },
    data: { saleCounter: { increment: 1 } },
    select: { saleCounter: true },
  });
  return `SALE-${tenant.saleCounter}`;
}

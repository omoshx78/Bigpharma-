import { Router } from "express";
import { Department } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { logAction } from "../utils/audit";

const router = Router();

const VALID_DEPARTMENTS = ["CASHIER"];

const SALE_INCLUDE = {
  items: { include: { item: true } },
  billingItems: true,
  notes: { orderBy: { createdAt: "asc" as const } },
};

router.get("/:department", requireAuth, async (req: AuthedRequest, res) => {
  const tenantId = req.user!.tenantId;
  const department = req.params.department.toUpperCase();
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: `Unknown department "${req.params.department}"` });
  }

  const [waiting, mine] = await Promise.all([
    prisma.queueEntry.findMany({
      where: { tenantId, department: department as Department, status: "WAITING" },
      include: { sale: { include: SALE_INCLUDE } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.queueEntry.findMany({
      where: { tenantId, department: department as Department, status: "CLAIMED", claimedById: req.user!.id },
      include: { sale: { include: SALE_INCLUDE } },
      orderBy: { claimedAt: "asc" },
    }),
  ]);

  res.json({ waiting, mine });
});

router.post("/:id/claim", requireAuth, async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const result = await prisma.queueEntry.updateMany({
    where: { id, tenantId, status: "WAITING" },
    data: { status: "CLAIMED", claimedById: req.user!.id, claimedAt: new Date() },
  });

  if (result.count === 0) {
    return res.status(409).json({ error: "This sale was just claimed by someone else, or is no longer waiting. Refresh the queue." });
  }

  const entry = await prisma.queueEntry.findFirst({ where: { id, tenantId }, include: { sale: { include: SALE_INCLUDE } } });
  await logAction({ tenantId, userId: req.user!.id, action: "queue.claim", entityType: "QueueEntry", entityId: id, details: { department: entry?.department, saleId: entry?.saleId } });
  res.json(entry);
});

router.post("/:id/release", requireAuth, async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const tenantId = req.user!.tenantId;

  const entry = await prisma.queueEntry.findFirst({ where: { id, tenantId } });
  if (!entry) return res.status(404).json({ error: "Queue entry not found" });
  if (entry.status !== "CLAIMED") return res.status(400).json({ error: "This sale isn't currently claimed" });
  if (entry.claimedById !== req.user!.id && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "Only the staff member who claimed this sale can release it" });
  }

  const updated = await prisma.queueEntry.update({ where: { id }, data: { status: "WAITING", claimedById: null, claimedAt: null } });
  await logAction({ tenantId, userId: req.user!.id, action: "queue.release", entityType: "QueueEntry", entityId: id });
  res.json(updated);
});

export default router;

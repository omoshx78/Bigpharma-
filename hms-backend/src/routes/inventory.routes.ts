import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { logAction } from "../utils/audit";

const router = Router();

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const category = req.query.category as string | undefined;
  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: req.user!.tenantId, ...(category ? { category } : {}) },
    orderBy: { name: "asc" },
  });
  const filtered = req.query.lowStock === "true" ? items.filter((i) => i.quantity <= i.reorderLevel) : items;
  res.json(filtered);
});

const createItemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["Medicine", "Consumable", "Equipment"]),
  unit: z.string().min(1),
  quantity: z.number().int().min(0).default(0),
  reorderLevel: z.number().int().min(0).default(0),
  unitPrice: z.number().min(0),
  expiryDate: z.string().datetime().optional(),
  batchNo: z.string().optional(),
});

router.post("/", requireAuth, requireRole("ORDER_TAKER"), async (req: AuthedRequest, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const item = await prisma.inventoryItem.create({
    data: {
      ...parsed.data,
      tenantId: req.user!.tenantId,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : undefined,
    },
  });

  if (item.quantity > 0) {
    await prisma.inventoryTransaction.create({
      data: { tenantId: req.user!.tenantId, itemId: item.id, changeQty: item.quantity, reason: "Initial stock", createdById: req.user!.id },
    });
  }

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "inventory.item_created", entityType: "InventoryItem", entityId: item.id });
  res.status(201).json(item);
});

const restockSchema = z.object({ quantity: z.number().int().min(1), reason: z.string().default("Restock") });

router.post("/:id/restock", requireAuth, requireRole("ORDER_TAKER"), async (req: AuthedRequest, res) => {
  const parsed = restockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const item = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!item) return res.status(404).json({ error: "Inventory item not found" });

  const [updated] = await prisma.$transaction([
    prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: { increment: parsed.data.quantity } } }),
    prisma.inventoryTransaction.create({
      data: { tenantId: req.user!.tenantId, itemId: item.id, changeQty: parsed.data.quantity, reason: parsed.data.reason, createdById: req.user!.id },
    }),
  ]);

  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "inventory.restocked", entityType: "InventoryItem", entityId: item.id, details: parsed.data });
  res.json(updated);
});

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  unitPrice: z.number().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
});

router.patch("/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Inventory item not found" });

  const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data: parsed.data });
  await logAction({ tenantId: req.user!.tenantId, userId: req.user!.id, action: "inventory.item_updated", entityType: "InventoryItem", entityId: item.id, details: parsed.data });
  res.json(item);
});

router.get("/:id/transactions", requireAuth, async (req: AuthedRequest, res) => {
  const item = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!item) return res.status(404).json({ error: "Inventory item not found" });

  const transactions = await prisma.inventoryTransaction.findMany({
    where: { tenantId: req.user!.tenantId, itemId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(transactions);
});

export default router;

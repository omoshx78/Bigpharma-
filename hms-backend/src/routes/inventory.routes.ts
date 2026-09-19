import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { logAction } from "../utils/audit";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB cap — a stock list has no business being bigger than this

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

const ADJUSTMENT_REASONS = ["Expired", "Damaged", "Stocktake correction", "Internal use", "Theft/loss", "Other"] as const;

const adjustSchema = z.object({
  quantity: z.number().int().refine((n) => n !== 0, "Quantity can't be zero"),
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: z.string().max(500).optional(),
});

/**
 * POST /:id/adjust — write off (or add back) stock that moves for a reason
 * OTHER than a sale or a delivery/restock: expiry, breakage, a stocktake
 * correction, internal use, loss, etc. Unlike /restock, this accepts a
 * signed quantity, so it's the one place stock can go down without going
 * through the sales flow. Every adjustment requires a categorized reason
 * and is written to both the inventory ledger and the audit log so it's
 * always traceable to who did it and why.
 */
router.post("/:id/adjust", requireAuth, requireRole("ORDER_TAKER"), async (req: AuthedRequest, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { quantity, reason, notes } = parsed.data;

  const item = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!item) return res.status(404).json({ error: "Inventory item not found" });

  if (quantity < 0 && item.quantity + quantity < 0) {
    return res.status(409).json({ error: `Can't remove ${Math.abs(quantity)} — only ${item.quantity} ${item.unit} in stock` });
  }

  const fullReason = notes ? `${reason}: ${notes}` : reason;

  const [updated] = await prisma.$transaction([
    prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: { increment: quantity } } }),
    prisma.inventoryTransaction.create({
      data: { tenantId: req.user!.tenantId, itemId: item.id, changeQty: quantity, reason: fullReason, createdById: req.user!.id },
    }),
  ]);

  await logAction({
    tenantId: req.user!.tenantId,
    userId: req.user!.id,
    action: "inventory.adjusted",
    entityType: "InventoryItem",
    entityId: item.id,
    details: { quantity, reason, notes },
  });
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

// ---------------------------------------------------------------------
// Bulk stock import from Excel/CSV
// ---------------------------------------------------------------------

const IMPORT_HEADERS = ["Name", "Category", "Unit", "Quantity", "Reorder Level", "Unit Price", "Expiry Date", "Batch No"];

/** GET /inventory/import/template — a starter .xlsx with the exact headers the importer expects, plus one example row. Public (no requireAuth) since it's generic and carries no tenant data — lets the frontend use a plain download link. */
router.get("/import/template", async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stock");
  sheet.addRow(IMPORT_HEADERS);
  sheet.addRow(["Paracetamol 500mg", "Medicine", "tablet", 200, 50, 5, "2027-06-30", "PCM-2501"]);
  sheet.addRow(["Surgical Gloves (box)", "Consumable", "box", 20, 10, 300, "", ""]);
  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="stock-import-template.xlsx"');
  res.send(Buffer.from(buffer));
});

const VALID_CATEGORIES = ["Medicine", "Consumable", "Equipment"];

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase()] = v;
  return out;
}

/**
 * Converts an ExcelJS worksheet into the same shape SheetJS's
 * sheet_to_json used to produce — an array of objects keyed by the
 * header row — so none of the row-validation logic below this needs to
 * change, only how the file gets read.
 */
function worksheetToObjects(worksheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    const values = row.values as unknown[]; // 1-indexed; values[0] is unused
    if (rowNumber === 1) {
      headers = values.slice(1).map((h) => String(h ?? "").trim());
      return;
    }
    const obj: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      let v: unknown = values[i + 1];
      if (v && typeof v === "object") {
        if ("result" in (v as any)) v = (v as any).result; // formula cell
        else if ("text" in (v as any)) v = (v as any).text; // rich-text cell
      }
      obj[header] = v ?? "";
    });
    rows.push(obj);
  });
  return rows;
}

interface ImportRowResult {
  row: number;
  name?: string;
  status: "created" | "skipped" | "error";
  reason?: string;
}

/**
 * POST /inventory/import — bulk-add inventory from an uploaded Excel or
 * CSV file. Rows matching an EXISTING item by name (case-insensitive,
 * within this tenant) are skipped, not updated — use Restock or Adjust
 * for changing an existing item's quantity. Every created row goes
 * through the exact same two-step InventoryItem + InventoryTransaction
 * creation as a manually-added item, so the stock ledger looks
 * identical either way.
 */
router.post("/import", requireAuth, requireRole("ORDER_TAKER"), upload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let sheet: Record<string, unknown>[];
  try {
    const isCsv = req.file.originalname.toLowerCase().endsWith(".csv") || req.file.mimetype.includes("csv");
    const workbook = new ExcelJS.Workbook();
    let worksheet: ExcelJS.Worksheet;
    if (isCsv) {
      worksheet = await workbook.csv.read(Readable.from(req.file.buffer as any));
    } else {
      await workbook.xlsx.load(req.file.buffer as any);
      const first = workbook.worksheets[0];
      if (!first) throw new Error("empty workbook");
      worksheet = first;
    }
    sheet = worksheetToObjects(worksheet);
  } catch {
    return res.status(400).json({ error: "Could not read that file — make sure it's a valid .xlsx or .csv file" });
  }

  if (sheet.length === 0) return res.status(400).json({ error: "That file has no data rows" });
  if (sheet.length > 2000) return res.status(400).json({ error: "That's a lot of rows (over 2000) — split it into smaller batches" });

  const tenantId = req.user!.tenantId;
  const results: ImportRowResult[] = [];
  let created = 0;

  for (let i = 0; i < sheet.length; i++) {
    const rowNum = i + 2; // account for the header row
    const row = normalizeRowKeys(sheet[i]);
    const name = String(row["name"] ?? "").trim();

    if (!name) {
      results.push({ row: rowNum, status: "error", reason: "Missing name" });
      continue;
    }

    const rawCategory = String(row["category"] ?? "").trim();
    const category = VALID_CATEGORIES.find((c) => c.toLowerCase() === rawCategory.toLowerCase());
    if (!category) {
      results.push({ row: rowNum, name, status: "error", reason: `Category must be one of ${VALID_CATEGORIES.join(", ")}` });
      continue;
    }

    const unit = String(row["unit"] ?? "").trim();
    if (!unit) {
      results.push({ row: rowNum, name, status: "error", reason: "Missing unit" });
      continue;
    }

    const quantity = Number(row["quantity"] ?? 0);
    const reorderLevel = Number(row["reorder level"] ?? 0);
    const unitPrice = Number(row["unit price"] ?? NaN);
    if (!Number.isFinite(quantity) || quantity < 0) {
      results.push({ row: rowNum, name, status: "error", reason: "Invalid quantity" });
      continue;
    }
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
      results.push({ row: rowNum, name, status: "error", reason: "Invalid reorder level" });
      continue;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      results.push({ row: rowNum, name, status: "error", reason: "Invalid unit price" });
      continue;
    }

    let expiryDate: Date | undefined;
    const rawExpiry = row["expiry date"];
    if (rawExpiry instanceof Date) {
      expiryDate = rawExpiry;
    } else if (typeof rawExpiry === "string" && rawExpiry.trim()) {
      const d = new Date(rawExpiry.trim());
      if (Number.isNaN(d.getTime())) {
        results.push({ row: rowNum, name, status: "error", reason: "Invalid expiry date — use YYYY-MM-DD" });
        continue;
      }
      expiryDate = d;
    }

    const batchNo = String(row["batch no"] ?? "").trim() || undefined;

    const existing = await prisma.inventoryItem.findFirst({
      where: { tenantId, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
      results.push({ row: rowNum, name, status: "skipped", reason: "An item with this name already exists" });
      continue;
    }

    const item = await prisma.inventoryItem.create({
      data: { tenantId, name, category, unit, quantity, reorderLevel, unitPrice, expiryDate, batchNo },
    });
    if (item.quantity > 0) {
      await prisma.inventoryTransaction.create({
        data: { tenantId, itemId: item.id, changeQty: item.quantity, reason: "Initial stock (import)", createdById: req.user!.id },
      });
    }
    results.push({ row: rowNum, name, status: "created" });
    created += 1;
  }

  const skipped = results.filter((r) => r.status === "skipped");
  const errors = results.filter((r) => r.status === "error");

  await logAction({
    tenantId,
    userId: req.user!.id,
    action: "inventory.bulk_imported",
    entityType: "InventoryItem",
    details: { created, skipped: skipped.length, errors: errors.length, filename: req.file.originalname },
  });

  res.status(201).json({ created, skipped, errors, totalRows: sheet.length });
});

export default router;

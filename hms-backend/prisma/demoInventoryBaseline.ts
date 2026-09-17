/**
 * The baseline stock list for the public demo tenant — shared between
 * seed.ts (first-time creation) and reset-demo-data.ts (periodic
 * cleanup), so the two can never drift out of sync with each other.
 */
export const DEMO_INVENTORY = [
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

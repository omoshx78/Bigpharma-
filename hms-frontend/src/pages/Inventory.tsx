import { useState, useEffect, useRef, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Printer, Upload, Download, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner, money } from "../components/ui";
import { InventoryItem } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const CATEGORIES = ["All", "Medicine", "Consumable", "Equipment"];
const ADJUST_REASONS = ["Expired", "Damaged", "Stocktake correction", "Internal use", "Theft/loss", "Other"];

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [restockAmounts, setRestockAmounts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", category: "Medicine", unit: "tablet", quantity: "0", reorderLevel: "20", unitPrice: "0" });
  const [adjustFor, setAdjustFor] = useState<string | null>(null);
  const [adjustForm, setAdjustForm] = useState({ quantity: "", reason: ADJUST_REASONS[0], notes: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: { row: number; name?: string; reason?: string }[]; errors: { row: number; name?: string; reason?: string }[] } | null>(null);

  const load = async () => {
    try {
      setItems(await api.get(filter === "All" ? "/inventory" : `/inventory?category=${filter}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load inventory");
    }
  };
  useEffect(() => { load(); }, [filter]);

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/inventory", {
        name: form.name,
        category: form.category,
        unit: form.unit,
        quantity: Number(form.quantity),
        reorderLevel: Number(form.reorderLevel),
        unitPrice: Number(form.unitPrice),
      });
      setForm({ name: "", category: "Medicine", unit: "tablet", quantity: "0", reorderLevel: "20", unitPrice: "0" });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add item");
    }
  };

  const restock = async (id: string) => {
    const qty = Number(restockAmounts[id] || 0);
    if (qty <= 0) return;
    try {
      await api.post(`/inventory/${id}/restock`, { quantity: qty });
      setRestockAmounts((r) => ({ ...r, [id]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not restock");
    }
  };

  const openAdjust = (id: string) => {
    setAdjustFor(id);
    setAdjustForm({ quantity: "", reason: ADJUST_REASONS[0], notes: "" });
  };

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustFor) return;
    const qty = Number(adjustForm.quantity);
    if (!qty) return;
    try {
      await api.post(`/inventory/${adjustFor}/adjust`, { quantity: qty, reason: adjustForm.reason, notes: adjustForm.notes || undefined });
      setAdjustFor(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not adjust stock");
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.upload("/inventory/import", formData);
      setImportResult(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import that file");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div>
      <SectionHeader
        title="Inventory & stock"
        subtitle="Medicines, consumables and equipment stock levels"
        action={
          <div className="flex gap-2">
            <Link to="/print/stock" target="_blank" className="border border-slate-300 text-slate-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5"><Printer size={15} /> Print stock list</Link>
            <a href={`${API_URL}/inventory/import/template`} className="border border-slate-300 text-slate-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5"><Download size={15} /> Download template</a>
            <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="border border-slate-300 text-slate-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Upload size={15} /> {importing ? "Importing..." : "Import Excel"}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelected} className="hidden" />
            <button onClick={() => setShowAdd((s) => !s)} className="bg-dhs-800 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-dhs-900 inline-flex items-center gap-1.5"><Plus size={15} /> Add item</button>
          </div>
        }
      />
      <ErrorBanner message={error} />

      {importResult && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 relative">
          <button onClick={() => setImportResult(null)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"><X size={16} /></button>
          <p className="text-sm font-medium text-slate-700 mb-1">
            Import complete: <span className="text-emerald-700">{importResult.created} added</span>
            {importResult.skipped.length > 0 && <span className="text-amber-700">, {importResult.skipped.length} skipped</span>}
            {importResult.errors.length > 0 && <span className="text-rose-700">, {importResult.errors.length} had errors</span>}
          </p>
          {(importResult.skipped.length > 0 || importResult.errors.length > 0) && (
            <ul className="text-xs text-slate-500 mt-2 space-y-0.5 max-h-32 overflow-auto">
              {importResult.skipped.map((r, i) => <li key={`s${i}`}>Row {r.row} ({r.name}): {r.reason}</li>)}
              {importResult.errors.map((r, i) => <li key={`e${i}`} className="text-rose-600">Row {r.row}{r.name ? ` (${r.name})` : ""}: {r.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      {showAdd && (
        <Card className="mb-4">
          <form onSubmit={submitAdd} className="grid grid-cols-6 gap-2.5 items-end">
            <label className="text-sm">Name<input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Category
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option>Medicine</option><option>Consumable</option><option>Equipment</option>
              </select>
            </label>
            <label className="text-sm">Unit<input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Qty<input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Reorder at<input type="number" value={form.reorderLevel} onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Unit price<input type="number" step="0.01" value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <button className="col-span-6 mt-1 bg-dhs-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-dhs-900">Save item</button>
          </form>
        </Card>
      )}
      <div className="flex gap-2 mb-3">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`text-xs px-3 py-1.5 rounded-full border ${filter === c ? "bg-dhs-800 text-white border-dhs-800" : "border-slate-300 text-slate-600 hover:bg-slate-100"}`}>{c}</button>
        ))}
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 font-normal">Item</th><th className="font-normal">Category</th><th className="font-normal">Stock</th><th className="font-normal">Reorder at</th><th className="font-normal">Unit price</th><th className="font-normal">Restock</th><th className="font-normal">Write off / adjust</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2">{i.name}</td>
                <td className="text-slate-500">{i.category}</td>
                <td>
                  <Badge className={i.quantity <= i.reorderLevel ? "bg-rose-100 text-rose-800 border-rose-300" : "bg-emerald-100 text-emerald-800 border-emerald-300"}>
                    {i.quantity} {i.unit}
                  </Badge>
                </td>
                <td className="text-slate-500">{i.reorderLevel}</td>
                <td className="text-slate-500">{money(i.unitPrice)}</td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <input type="number" placeholder="qty" value={restockAmounts[i.id] || ""} onChange={(e) => setRestockAmounts((r) => ({ ...r, [i.id]: e.target.value }))} className="w-16 border border-slate-300 rounded px-2 py-1 text-xs" />
                    <button onClick={() => restock(i.id)} className="text-xs text-dhs-700 hover:underline">Add</button>
                  </div>
                </td>
                <td>
                  <button onClick={() => openAdjust(i.id)} className="text-xs text-rose-700 hover:underline">Adjust</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {adjustFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setAdjustFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl p-6 w-full max-w-sm border border-slate-200">
            <h3 className="text-sm font-semibold mb-1">Adjust stock</h3>
            <p className="text-xs text-slate-500 mb-4">{items.find((i) => i.id === adjustFor)?.name} — currently {items.find((i) => i.id === adjustFor)?.quantity} {items.find((i) => i.id === adjustFor)?.unit}</p>
            <form onSubmit={submitAdjust} className="space-y-3">
              <label className="text-sm block">
                Quantity change
                <input
                  required
                  type="number"
                  placeholder="e.g. -5 to remove 5, or 5 to add 5"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-xs text-slate-400 mt-1 block">Use a negative number to remove stock (expired, damaged, etc), positive to add it back.</span>
              </label>
              <label className="text-sm block">
                Reason
                <select value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  {ADJUST_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              <label className="text-sm block">
                Notes (optional)
                <input value={adjustForm.notes} onChange={(e) => setAdjustForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Batch no, details..." />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAdjustFor(null)} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm hover:bg-slate-50">Cancel</button>
                <button className="flex-1 bg-rose-700 text-white rounded-lg py-2 text-sm font-medium hover:bg-rose-800">Save adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

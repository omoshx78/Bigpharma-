import { useState, useEffect, FormEvent } from "react";
import { Trash2, ShoppingCart, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, ErrorBanner, money } from "../components/ui";
import { InventoryItem } from "../types";

export default function NewSale() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [lines, setLines] = useState<{ itemId: string; name: string; qty: number; unitPrice: number; stock: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadItems = () => {
    setItemsError(null);
    api.get("/inventory")
      .then(setItems)
      .catch((err) => setItemsError(err instanceof ApiError ? err.message : "Could not load stock list"));
  };
  useEffect(() => { loadItems(); }, []);

  const addLine = (itemId: string) => {
    if (!itemId || lines.find((l) => l.itemId === itemId)) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setLines((ls) => [...ls, { itemId, name: item.name, qty: 1, unitPrice: Number(item.unitPrice), stock: item.quantity }]);
  };

  const setQty = (itemId: string, qty: number) => setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, qty: Math.max(1, qty) } : l)));
  const removeLine = (itemId: string) => setLines((ls) => ls.filter((l) => l.itemId !== itemId));

  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const overStock = lines.some((l) => l.qty > l.stock);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await api.post("/sales", {
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })),
      });
      setSuccess(`${res.saleNo} created — ${money(total)}. Sent to Cashier for payment.`);
      setCustomerName("");
      setCustomerPhone("");
      setLines([]);
      loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create sale");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <SectionHeader title="New Sale" subtitle="Pick items for a customer — this dispenses stock immediately and sends the order to Cashier" />
      <ErrorBanner message={error} />
      {success && <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200 flex items-center gap-2"><CheckCircle2 size={15} /> {success}</div>}

      <div className="grid grid-cols-3 gap-5">
        <Card>
          <p className="font-medium text-sm mb-3">Customer (optional)</p>
          <label className="text-sm block mb-2">Name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-sm block">Phone<input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
        </Card>

        <Card className="col-span-2">
          <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><ShoppingCart size={15} /> Items</p>
          {itemsError ? (
            <div className="flex items-center justify-between border border-rose-200 bg-rose-50 rounded-lg px-3 py-2 mb-3">
              <p className="text-xs text-rose-600">{itemsError}</p>
              <button onClick={loadItems} className="text-xs text-dhs-700 hover:underline">Retry</button>
            </div>
          ) : (
            <select onChange={(e) => { addLine(e.target.value); e.target.value = ""; }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" defaultValue="">
              <option value="" disabled>{items.length === 0 ? "Loading stock..." : "Add item..."}</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} in stock) — {money(i.unitPrice)}</option>)}
            </select>
          )}

          {lines.length > 0 && (
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 font-normal">Item</th><th className="font-normal">Qty</th><th className="font-normal">Price</th><th className="font-normal text-right">Line total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.itemId} className="border-b border-slate-100">
                    <td className="py-1.5">{l.name}{l.qty > l.stock && <span className="text-rose-600 text-xs ml-1.5">(only {l.stock} in stock)</span>}</td>
                    <td><input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.itemId, Number(e.target.value))} className="w-16 border border-slate-300 rounded px-2 py-1 text-xs" /></td>
                    <td className="text-slate-500">{money(l.unitPrice)}</td>
                    <td className="text-right">{money(l.qty * l.unitPrice)}</td>
                    <td><button type="button" onClick={() => removeLine(l.itemId)}><Trash2 size={14} className="text-slate-400 hover:text-rose-600" /></button></td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="pt-2 font-medium">Total</td>
                  <td className="pt-2 font-semibold text-right">{money(total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}

          {overStock && <p className="text-xs text-rose-600 mb-2">One or more quantities exceed available stock — adjust before submitting.</p>}

          <form onSubmit={submit}>
            <button disabled={submitting || lines.length === 0 || overStock} className="bg-dhs-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-dhs-900 disabled:opacity-50">
              {submitting ? "Saving..." : "Complete sale & send to Cashier"}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

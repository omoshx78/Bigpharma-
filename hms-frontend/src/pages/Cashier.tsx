import { useState, FormEvent } from "react";
import { Plus } from "lucide-react";
import { QueueBoard } from "../components/QueueBoard";
import { api, ApiError } from "../api/client";
import { QueueEntry, BillingItem } from "../types";
import { ErrorBanner, money } from "../components/ui";

function CashierForm({ entry, onDone }: { entry: QueueEntry; onDone: () => void }) {
  const sale = entry.sale;
  const [items, setItems] = useState<BillingItem[]>(sale.billingItems || []);
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const [method, setMethod] = useState<"CASH" | "INSURANCE">("CASH");
  const [provider, setProvider] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [addingCharge, setAddingCharge] = useState(false);

  const addCharge = async (e: FormEvent) => {
    e.preventDefault();
    if (!chargeDesc || !chargeAmount) return;
    setError(null);
    setAddingCharge(true);
    try {
      await api.post(`/sales/${sale.id}/billing-items`, { description: chargeDesc, amount: Number(chargeAmount) });
      const fresh = await api.get(`/sales/${sale.id}`);
      setItems(fresh.billingItems || []);
      setChargeDesc("");
      setChargeAmount("");
      setShowAddCharge(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add charge");
    } finally {
      setAddingCharge(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/sales/${sale.id}/payment`, {
        method,
        insuranceProvider: method === "INSURANCE" ? provider : undefined,
        claimNo: method === "INSURANCE" ? claimNo : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <p className="font-medium mb-3">{sale.customerName || "Walk-in"} <span className="text-slate-400 font-normal text-sm">({sale.saleNo})</span></p>
      <ErrorBanner message={error} />
      {(sale.notes || []).length > 0 && (
        <div className="mb-3 space-y-1">
          {sale.notes!.map((n) => <p key={n.id} className="text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">{n.note}</p>)}
        </div>
      )}
      <table className="w-full text-sm mb-2">
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-1.5">{it.description}</td>
              <td className="py-1.5 text-right">{money(it.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-medium">Total due</td>
            <td className="pt-2 font-semibold text-right">{money(total)}</td>
          </tr>
        </tbody>
      </table>

      {!showAddCharge ? (
        <button type="button" onClick={() => setShowAddCharge(true)} className="text-xs text-dhs-700 hover:underline inline-flex items-center gap-1 mb-3">
          <Plus size={12} /> Add a charge to this bill
        </button>
      ) : (
        <div className="flex gap-1.5 items-end mb-3 bg-slate-50 rounded-lg p-2.5">
          <label className="text-xs flex-1">Description
            <input value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" placeholder="e.g. Delivery fee" />
          </label>
          <label className="text-xs w-28">Amount (KSh)
            <input type="number" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <button type="button" onClick={addCharge} disabled={addingCharge || !chargeDesc || !chargeAmount} className="text-xs bg-dhs-800 text-white rounded-lg py-1.5 px-3 hover:bg-dhs-900 disabled:opacity-50">
            {addingCharge ? "Adding..." : "Add"}
          </button>
          <button type="button" onClick={() => setShowAddCharge(false)} className="text-xs text-slate-400 hover:text-rose-600 px-1">Cancel</button>
        </div>
      )}

      <div className="flex gap-4 mb-3">
        <label className="text-sm flex items-center gap-1.5"><input type="radio" checked={method === "CASH"} onChange={() => setMethod("CASH")} /> Cash</label>
        <label className="text-sm flex items-center gap-1.5"><input type="radio" checked={method === "INSURANCE"} onChange={() => setMethod("INSURANCE")} /> Insurance</label>
      </div>
      {method === "INSURANCE" && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="text-sm">Insurance provider<input required value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-sm">Claim / approval no.<input value={claimNo} onChange={(e) => setClaimNo(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <p className="col-span-2 text-xs text-slate-500 -mt-1">This submits a claim. It won't count as collected until it's marked "Paid" (Reports → Insurance claims, in full or in installments).</p>
        </div>
      )}
      <button disabled={submitting} className="bg-dhs-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-dhs-900 disabled:opacity-50">
        {submitting ? "Saving..." : method === "INSURANCE" ? "Submit claim & complete sale" : "Confirm payment & complete sale"}
      </button>
    </form>
  );
}

export default function Cashier() {
  return (
    <QueueBoard
      department="CASHIER"
      title="Cashier"
      subtitle="Generate invoice and capture payment"
      renderAction={(entry, onDone) => <CashierForm entry={entry} onDone={onDone} />}
    />
  );
}

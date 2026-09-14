import { useState, useEffect, FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertTriangle, Pencil, X } from "lucide-react";
import { platformApi } from "./api";
import { ApiError } from "../api/client";

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  state: "ACTIVE" | "GRACE" | "LOCKED";
  currentPeriodEnd: string;
  amount: number;
  currency: string;
  hasCustomPrice: boolean;
  platformDefaultAmount: number;
  platformDefaultCurrency: string;
}

interface Payment {
  id: string;
  provider: "FLUTTERWAVE" | "DARAJA" | "MANUAL";
  amount: number;
  currency: string;
  kesAmount: number | null;
  status: string;
  paidAt: string | null;
  txRef: string;
  notes: string | null;
}

const STATE_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-950 text-emerald-400 border-emerald-800",
  GRACE: "bg-amber-950 text-amber-400 border-amber-800",
  LOCKED: "bg-rose-950 text-rose-400 border-rose-800",
};

export default function PlatformTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", currency: "USD", periodDays: "30", notes: "" });

  const [editingPrice, setEditingPrice] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceForm, setPriceForm] = useState({ amount: "", currency: "USD" });

  const load = () => {
    if (!id) return;
    platformApi
      .get(`/platform/tenants/${id}/payments`)
      .then((res) => {
        setTenant(res.tenant);
        setPayments(res.payments);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tenant"));
  };

  useEffect(load, [id]);

  const submitPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmittingPayment(true);
    setError(null);
    try {
      await platformApi.post(`/platform/tenants/${id}/record-payment`, {
        amount: Number(paymentForm.amount),
        currency: paymentForm.currency.toUpperCase(),
        periodDays: Number(paymentForm.periodDays),
        notes: paymentForm.notes || undefined,
      });
      setShowPaymentForm(false);
      setPaymentForm({ amount: "", currency: "USD", periodDays: "30", notes: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const openPriceEditor = () => {
    if (tenant) setPriceForm({ amount: String(tenant.amount), currency: tenant.currency });
    setEditingPrice(true);
  };

  const patchPrice = (tenantId: string, body: { clear: true } | { amount: number; currency: string }) =>
    platformApi.patch(`/platform/tenants/${tenantId}/price`, body);

  const clearPriceOverride = async () => {
    if (!id) return;
    setSavingPrice(true);
    setError(null);
    try {
      await patchPrice(id, { clear: true });
      setEditingPrice(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear price override");
    } finally {
      setSavingPrice(false);
    }
  };

  const submitPrice = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingPrice(true);
    setError(null);
    try {
      await patchPrice(id, { amount: Number(priceForm.amount), currency: priceForm.currency.toUpperCase() });
      setEditingPrice(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update price");
    } finally {
      setSavingPrice(false);
    }
  };

  if (!tenant) {
    return (
      <div>
        {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <Link to="/platform" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-4"><ArrowLeft size={14} /> Back to dashboard</Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">{tenant.name}</h1>
          <p className="text-sm text-slate-500">{tenant.slug}</p>
        </div>
        <button onClick={() => setShowPaymentForm(true)} className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-700">
          Record manual payment
        </button>
      </div>

      {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Status</p>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATE_STYLE[tenant.state]}`}>{tenant.state}</span>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Renews / due</p>
          <p className="text-sm text-slate-200">{new Date(tenant.currentPeriodEnd).toLocaleDateString()}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
            Price {tenant.hasCustomPrice && <span className="text-sky-400 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-950 border border-sky-800">custom</span>}
          </p>
          {!editingPrice ? (
            <p className="text-sm text-slate-200 flex items-center gap-2">
              {tenant.currency} {tenant.amount.toLocaleString()}
              <button onClick={openPriceEditor} className="text-slate-500 hover:text-white"><Pencil size={13} /></button>
            </p>
          ) : (
            <form onSubmit={submitPrice} className="flex items-center gap-1.5">
              <input required type="number" step="0.01" min="0.01" value={priceForm.amount} onChange={(e) => setPriceForm((f) => ({ ...f, amount: e.target.value }))} className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
              <input required value={priceForm.currency} onChange={(e) => setPriceForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} className="w-14 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
              <button disabled={savingPrice} className="text-emerald-400 hover:text-emerald-300 text-xs font-medium">Save</button>
              <button type="button" onClick={() => setEditingPrice(false)} className="text-slate-500 hover:text-white"><X size={13} /></button>
            </form>
          )}
          {editingPrice && tenant.hasCustomPrice && (
            <button onClick={clearPriceOverride} disabled={savingPrice} className="text-xs text-slate-500 hover:text-rose-400 mt-1">
              Remove override (use platform default: {tenant.platformDefaultCurrency} {tenant.platformDefaultAmount})
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2.5 font-normal">Provider</th>
              <th className="px-4 py-2.5 font-normal">Amount</th>
              <th className="px-4 py-2.5 font-normal">Status</th>
              <th className="px-4 py-2.5 font-normal">Paid</th>
              <th className="px-4 py-2.5 font-normal">Reference / notes</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${p.provider === "MANUAL" ? "bg-sky-950 text-sky-400 border-sky-800" : "bg-slate-800 text-slate-300 border-slate-700"}`}>{p.provider}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-300">
                  {p.currency} {p.amount.toLocaleString()}
                  {p.kesAmount != null && p.currency !== "KES" && <span className="text-xs text-slate-500"> (KES {Number(p.kesAmount).toLocaleString()})</span>}
                </td>
                <td className="px-4 py-2.5">
                  {p.status === "SUCCESSFUL" ? (
                    <span className="text-emerald-400 flex items-center gap-1 text-xs"><CheckCircle2 size={13} /> Successful</span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1 text-xs"><AlertTriangle size={13} /> {p.status}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-300">{p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{p.notes || p.txRef}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No payments recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPaymentForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPaymentForm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-white mb-1">Record manual payment</h3>
            <p className="text-xs text-slate-500 mb-4">For a payment made outside the system — bank transfer, cash, etc. Extends their subscription exactly like a real payment would.</p>
            <form onSubmit={submitPayment} className="space-y-3">
              <div className="flex gap-2">
                <label className="text-sm block text-slate-300 flex-1">
                  Amount
                  <input required type="number" step="0.01" min="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-sm block text-slate-300 w-24">
                  Currency
                  <input required value={paymentForm.currency} onChange={(e) => setPaymentForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </label>
              </div>
              <label className="text-sm block text-slate-300">
                Extend subscription by (days)
                <input required type="number" min="1" value={paymentForm.periodDays} onChange={(e) => setPaymentForm((f) => ({ ...f, periodDays: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-sm block text-slate-300">
                Notes (reference, how it was paid)
                <input value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Bank transfer ref #1234" className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowPaymentForm(false)} className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
                <button disabled={submittingPayment} className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{submittingPayment ? "Saving..." : "Record payment"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

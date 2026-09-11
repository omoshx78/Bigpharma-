import { useState, useEffect, FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import { platformApi } from "./api";
import { ApiError } from "../api/client";

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
  const [tenant, setTenant] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ amount: "", currency: "USD", periodDays: "30", notes: "" });

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.post(`/platform/tenants/${id}/record-payment`, {
        amount: Number(form.amount),
        currency: form.currency.toUpperCase(),
        periodDays: Number(form.periodDays),
        notes: form.notes || undefined,
      });
      setShowForm(false);
      setForm({ amount: "", currency: "USD", periodDays: "30", notes: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
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
        <button onClick={() => setShowForm(true)} className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-700">
          Record manual payment
        </button>
      </div>

      {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}

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

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-white mb-1">Record manual payment</h3>
            <p className="text-xs text-slate-500 mb-4">For a payment made outside the system \u2014 bank transfer, cash, etc. Extends their subscription exactly like a real payment would.</p>
            <form onSubmit={submit} className="space-y-3">
              <div className="flex gap-2">
                <label className="text-sm block text-slate-300 flex-1">
                  Amount
                  <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </label>
                <label className="text-sm block text-slate-300 w-24">
                  Currency
                  <input required value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                </label>
              </div>
              <label className="text-sm block text-slate-300">
                Extend subscription by (days)
                <input required type="number" min="1" value={form.periodDays} onChange={(e) => setForm((f) => ({ ...f, periodDays: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-sm block text-slate-300">
                Notes (reference, how it was paid)
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Bank transfer ref #1234" className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
                <button disabled={submitting} className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">{submitting ? "Saving..." : "Record payment"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

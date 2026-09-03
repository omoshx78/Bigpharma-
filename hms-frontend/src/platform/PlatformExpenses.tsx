import { useState, useEffect, FormEvent } from "react";
import { Printer, Download, Trash2 } from "lucide-react";
import { platformApi, downloadCsv } from "./api";
import { ApiError } from "../api/client";

interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  currency: string;
  vendor: string | null;
  notes: string | null;
}

export default function PlatformExpenses() {
  const [period, setPeriod] = useState<"today" | "month" | "all">("month");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), category: "", amount: "", currency: "USD", vendor: "", notes: "" });

  const load = () => {
    const q = period === "all" ? "" : `?period=${period}`;
    platformApi
      .get(`/platform/expenses${q}`)
      .then((res) => {
        setExpenses(res.expenses);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load expenses"));
  };

  useEffect(load, [period]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await platformApi.post("/platform/expenses", {
        date: new Date(form.date).toISOString(),
        category: form.category,
        amount: Number(form.amount),
        currency: form.currency,
        vendor: form.vendor || undefined,
        notes: form.notes || undefined,
      });
      setShowAdd(false);
      setForm({ date: new Date().toISOString().slice(0, 10), category: "", amount: "", currency: "USD", vendor: "", notes: "" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add expense");
    }
  };

  const remove = async (id: string) => {
    try {
      await platformApi.delete(`/platform/expenses/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete expense");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-white">Platform expenses</h1>
          <p className="text-sm text-slate-500">Your own operating costs — hosting, processor fees, etc.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value as "today" | "month" | "all")} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200">
            <option value="today">Today</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm text-slate-300 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <Printer size={14} /> Print
          </button>
          <button onClick={() => downloadCsv(`/platform/expenses?${period === "all" ? "" : `period=${period}&`}format=csv`, "platform-expenses.csv")} className="flex items-center gap-1.5 text-sm text-slate-300 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-700">
            Add expense
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}

      <p className="text-sm text-slate-400 mb-3">Total: <span className="text-white font-medium">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> <span className="text-xs">(same-currency only — mixed currencies aren't summed here)</span></p>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2.5 font-normal">Date</th>
              <th className="px-4 py-2.5 font-normal">Category</th>
              <th className="px-4 py-2.5 font-normal">Amount</th>
              <th className="px-4 py-2.5 font-normal">Vendor</th>
              <th className="px-4 py-2.5 font-normal">Notes</th>
              <th className="px-4 py-2.5 font-normal print:hidden"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="px-4 py-2.5 text-slate-300">{new Date(e.date).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-slate-100">{e.category}</td>
                <td className="px-4 py-2.5 text-slate-300">{e.currency} {e.amount.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-slate-300">{e.vendor || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{e.notes || "—"}</td>
                <td className="px-4 py-2.5 print:hidden">
                  <button onClick={() => remove(e.id)} className="text-slate-500 hover:text-rose-400"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No expenses in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-white mb-4">Add expense</h3>
            <form onSubmit={submit} className="space-y-3">
              <label className="text-sm block text-slate-300">
                Date
                <input required type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-sm block text-slate-300">
                Category
                <input required value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Hosting, processor fees, marketing..." className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
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
                Vendor (optional)
                <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-sm block text-slate-300">
                Notes (optional)
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowAdd(false)} className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
                <button className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

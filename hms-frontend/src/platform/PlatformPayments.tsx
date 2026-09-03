import { useState, useEffect } from "react";
import { Printer, Download } from "lucide-react";
import { platformApi, downloadCsv } from "./api";
import { ApiError } from "../api/client";

interface Payment {
  id: string;
  provider: "FLUTTERWAVE" | "DARAJA";
  amount: number;
  currency: string;
  kesAmount: number | null;
  paidAt: string | null;
  txRef: string;
  tenant: { name: string; slug: string };
}

export default function PlatformPayments() {
  const [period, setPeriod] = useState<"today" | "month" | "all">("month");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = period === "all" ? "" : `?period=${period}`;
    platformApi.get(`/platform/payments${q}`).then(setPayments).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load payments"));
  }, [period]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-white">Payments</h1>
          <p className="text-sm text-slate-500">Every successful subscription payment, across all tenants</p>
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
          <button onClick={() => downloadCsv(`/platform/payments?${period === "all" ? "" : `period=${period}&`}format=csv`, "payments.csv")} className="flex items-center gap-1.5 text-sm text-slate-300 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2.5 font-normal">Tenant</th>
              <th className="px-4 py-2.5 font-normal">Provider</th>
              <th className="px-4 py-2.5 font-normal">Amount</th>
              <th className="px-4 py-2.5 font-normal">Paid</th>
              <th className="px-4 py-2.5 font-normal">Reference</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="px-4 py-2.5 text-slate-100">{p.tenant.name}</td>
                <td className="px-4 py-2.5 text-slate-300">{p.provider}</td>
                <td className="px-4 py-2.5 text-slate-300">
                  {p.currency} {p.amount.toLocaleString()}
                  {p.kesAmount != null && p.currency !== "KES" && <span className="text-xs text-slate-500"> (KES {Number(p.kesAmount).toLocaleString()})</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-300">{p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{p.txRef}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No payments in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Printer, Download } from "lucide-react";
import { platformApi, downloadCsv } from "./api";
import { ApiError } from "../api/client";

interface Summary {
  period: string;
  reportingCurrency: string;
  tenantCount: number;
  active: number;
  grace: number;
  locked: number;
  revenue: number;
  paymentCount: number;
  expenses: number;
  otherCurrencyExpenseCount: number;
  net: number;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  state: "ACTIVE" | "GRACE" | "LOCKED";
  currentPeriodEnd: string;
  amount?: number;
  currency?: string;
  lastPaymentAt: string | null;
  lastPaymentProvider: string | null;
}

const STATE_STYLE: Record<TenantRow["state"], string> = {
  ACTIVE: "bg-emerald-950 text-emerald-400 border-emerald-800",
  GRACE: "bg-amber-950 text-amber-400 border-amber-800",
  LOCKED: "bg-rose-950 text-rose-400 border-rose-800",
};

export default function PlatformDashboard() {
  const [period, setPeriod] = useState<"today" | "month">("month");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi.get(`/platform/summary?period=${period}`).then(setSummary).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load summary"));
  }, [period]);

  useEffect(() => {
    platformApi.get("/platform/tenants").then(setTenants).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tenants"));
  }, []);

  return (
    <div className="print:text-black">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-lg font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-slate-500">Every tenant, at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value as "today" | "month")} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200">
            <option value="today">Today</option>
            <option value="month">This month</option>
          </select>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 text-sm text-slate-300 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <Printer size={14} /> Print
          </button>
          <button onClick={() => downloadCsv("/platform/tenants?format=csv", "tenants.csv")} className="flex items-center gap-1.5 text-sm text-slate-300 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-950 text-rose-400 text-sm border border-rose-800">{error}</div>}

      {summary && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Card label="Tenants" value={String(summary.tenantCount)} sub={`${summary.active} active`} />
          <Card label={`Revenue (${summary.period})`} value={`${summary.reportingCurrency} ${summary.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} sub={`${summary.paymentCount} payments`} />
          <Card label={`Expenses (${summary.period})`} value={`${summary.reportingCurrency} ${summary.expenses.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} sub={summary.otherCurrencyExpenseCount > 0 ? `+${summary.otherCurrencyExpenseCount} in other currencies` : undefined} />
          <Card label="Net" value={`${summary.reportingCurrency} ${summary.net.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} highlight={summary.net >= 0 ? "positive" : "negative"} />
        </div>
      )}

      {summary && (summary.grace > 0 || summary.locked > 0) && (
        <div className="flex gap-3 mb-6 text-sm print:hidden">
          {summary.grace > 0 && <span className="px-3 py-1 rounded-full bg-amber-950 text-amber-400 border border-amber-800">{summary.grace} in grace period</span>}
          {summary.locked > 0 && <span className="px-3 py-1 rounded-full bg-rose-950 text-rose-400 border border-rose-800">{summary.locked} locked (unpaid)</span>}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-2.5 font-normal">Tenant</th>
              <th className="px-4 py-2.5 font-normal">Status</th>
              <th className="px-4 py-2.5 font-normal">Price</th>
              <th className="px-4 py-2.5 font-normal">Renews / due</th>
              <th className="px-4 py-2.5 font-normal">Last payment</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-slate-800">
                <td className="px-4 py-2.5">
                  <p className="text-slate-100">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.slug}</p>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATE_STYLE[t.state]}`}>{t.state}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-300">{t.amount != null ? `${t.currency} ${t.amount.toLocaleString()}` : "—"}</td>
                <td className="px-4 py-2.5 text-slate-300">{new Date(t.currentPeriodEnd).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-slate-300">
                  {t.lastPaymentAt ? (
                    <>
                      {new Date(t.lastPaymentAt).toLocaleDateString()} <span className="text-xs text-slate-500">via {t.lastPaymentProvider}</span>
                    </>
                  ) : (
                    <span className="text-slate-600">Never paid</span>
                  )}
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No tenants yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "positive" | "negative" }) {
  const valueColor = highlight === "positive" ? "text-emerald-400" : highlight === "negative" ? "text-rose-400" : "text-white";
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

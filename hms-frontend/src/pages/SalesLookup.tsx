import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search, Printer, Receipt as ReceiptIcon } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner, money } from "../components/ui";
import { Sale } from "../types";

const STATUS_COLORS: Record<string, string> = {
  CASHIER: "bg-orange-100 text-orange-800 border-orange-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  CANCELLED: "bg-slate-200 text-slate-500 border-slate-300",
};

export default function SalesLookup() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Sale[]>([]);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        setResults(await api.get(`/sales?search=${encodeURIComponent(search.trim())}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load sales");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const select = async (s: Sale) => {
    try {
      setSelected(await api.get(`/sales/${s.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sale");
    }
  };

  const total = (s: Sale) => (s.billingItems || []).reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <div>
      <SectionHeader title="Sales Lookup" subtitle="Search recent and past sales by customer name, phone, or sale number" />
      <ErrorBanner message={error} />
      <div className="grid grid-cols-3 gap-5">
        <Card className="col-span-1">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or sale no..." className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-slate-400 mb-2">{search.trim() ? "Search results" : "Recent sales"}</p>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-slate-400">No sales found.</p>
          ) : (
            <ul className="space-y-2 max-h-[520px] overflow-auto">
              {results.map((s) => (
                <li key={s.id}>
                  <button onClick={() => select(s)} className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${selected?.id === s.id ? "border-dhs-600 bg-dhs-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <div className="flex justify-between items-center">
                      <p className="font-medium">{s.customerName || "Walk-in"}</p>
                      <Badge className={STATUS_COLORS[s.status]}>{s.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">{s.saleNo} · {money(total(s))}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-2">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 border border-dashed border-slate-300 rounded-xl">
              <ReceiptIcon size={28} className="mb-2" />
              <p className="text-sm">Select a sale to view details.</p>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="font-medium">{selected.customerName || "Walk-in"} {selected.customerPhone && <span className="text-slate-400 font-normal text-sm">· {selected.customerPhone}</span>}</p>
                  <p className="text-xs text-slate-500">{selected.saleNo} · {new Date(selected.createdAt).toLocaleString()}</p>
                </div>
                <Badge className={STATUS_COLORS[selected.status]}>{selected.status}</Badge>
              </div>

              <p className="text-sm font-medium mb-2">Items</p>
              <table className="w-full text-sm mb-4">
                <tbody>
                  {selected.items.map((li) => (
                    <tr key={li.id} className="border-b border-slate-100">
                      <td className="py-1">{li.item.name} x{li.quantity}</td>
                      <td className="py-1 text-right">{money(Number(li.unitPrice) * li.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="text-sm font-medium mb-2">Billing</p>
              <table className="w-full text-sm mb-2">
                <tbody>
                  {selected.billingItems.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100"><td className="py-1">{it.description}</td><td className="py-1 text-right">{money(it.amount)}</td></tr>
                  ))}
                  <tr><td className="pt-1.5 font-medium">Total</td><td className="pt-1.5 font-semibold text-right">{money(total(selected))}</td></tr>
                </tbody>
              </table>

              {selected.payment && (
                <p className="text-xs text-slate-500 mb-3">
                  {selected.payment.method === "CASH"
                    ? `Paid in cash${selected.payment.paidAt ? ` on ${new Date(selected.payment.paidAt).toLocaleString()}` : ""}`
                    : selected.payment.claimStatus === "PARTIALLY_PAID"
                    ? `Insurance (${selected.payment.insuranceProvider || "—"}) — partially paid, ${money(total(selected) - Number(selected.payment.amountPaid))} remaining`
                    : `Insurance (${selected.payment.insuranceProvider || "—"}) — claim #${selected.payment.claimNo || "—"} — ${selected.payment.claimStatus}`}
                </p>
              )}

              <Link to={`/print/${selected.id}`} target="_blank" className="text-xs text-dhs-700 hover:underline inline-flex items-center gap-1">
                <Printer size={12} /> View / print receipt
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

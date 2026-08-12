import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Card, SectionHeader, Badge, money } from "../components/ui";

export default function Dashboard() {
  const { user } = useAuth();
  const [waitingCount, setWaitingCount] = useState(0);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        api.get("/queue/CASHIER"),
        api.get("/inventory?lowStock=true"),
        user?.role === "CASHIER" || user?.role === "ADMIN" ? api.get("/reports/summary?period=today") : Promise.resolve(null),
      ]);
      if (results[0].status === "fulfilled") setWaitingCount(results[0].value.waiting.length);
      if (results[1].status === "fulfilled") setLowStock(results[1].value);
      if (results[2].status === "fulfilled" && results[2].value) setSummary(results[2].value);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <div className="text-sm text-slate-400">Loading dashboard...</div>;

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle="Live overview of sales and stock" />

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Link to="/cashier">
          <Card className="!p-4 hover:border-dhs-400 transition">
            <p className="text-xs text-slate-500">Awaiting payment</p>
            <p className="text-2xl font-semibold mt-1">{waitingCount}</p>
          </Card>
        </Link>
        {summary && (
          <>
            <Card className="!p-4">
              <p className="text-xs text-slate-500">Collected today</p>
              <p className="text-xl font-semibold mt-1">{money(summary.totalCollected)}</p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs text-slate-500">Pending claims</p>
              <p className="text-xl font-semibold mt-1 text-amber-700">{money(summary.pendingClaims)}</p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs text-slate-500">Net today</p>
              <p className={`text-xl font-semibold mt-1 ${summary.net < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(summary.net)}</p>
            </Card>
          </>
        )}
      </div>

      <Card>
        <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><AlertTriangle size={15} className="text-amber-600" /> Low stock alerts</p>
        {lowStock.length === 0 ? (
          <p className="text-sm text-slate-400">All stock levels healthy.</p>
        ) : (
          <ul className="space-y-2">
            {lowStock.map((i) => (
              <li key={i.id} className="flex justify-between text-sm">
                <span>{i.name}</span>
                <Badge className="bg-rose-100 text-rose-800 border-rose-300">{i.quantity} {i.unit} left</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

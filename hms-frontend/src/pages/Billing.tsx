import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, CheckCircle2, AlertTriangle, Smartphone } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, ErrorBanner } from "../components/ui";

interface BillingStatus {
  state: "ACTIVE" | "GRACE" | "LOCKED";
  currentPeriodEnd: string;
  amount: number;
  currency: string;
  billingConfigured: boolean;
}

export default function Billing() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [params] = useSearchParams();
  const paidParam = params.get("paid");

  const load = () => {
    api.get("/billing/status").then(setStatus).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load billing status"));
  };

  useEffect(load, []);

  const startCheckout = async () => {
    setPaying(true);
    setError(null);
    try {
      const { link } = await api.post("/billing/checkout");
      window.location.href = link; // Flutterwave hosted checkout — offers card and M-Pesa as tabs
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start checkout");
      setPaying(false);
    }
  };

  const stateBadge = (state: BillingStatus["state"]) => {
    if (state === "ACTIVE") return <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 text-sm font-medium"><CheckCircle2 size={14} /> Active</span>;
    if (state === "GRACE") return <span className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 text-sm font-medium"><AlertTriangle size={14} /> Payment due (grace period)</span>;
    return <span className="inline-flex items-center gap-1.5 text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-3 py-1 text-sm font-medium"><AlertTriangle size={14} /> Read-only (payment overdue)</span>;
  };

  return (
    <div>
      <SectionHeader title="Billing" subtitle="Manage your monthly subscription" />
      <ErrorBanner message={error} />

      {paidParam === "1" && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">
          Payment received — your subscription has been extended.
        </div>
      )}
      {paidParam === "0" && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">
          That payment didn't go through, or couldn't be verified. No charge should have been made — try again below.
        </div>
      )}

      {status && (
        <Card className="max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">Subscription status</p>
            {stateBadge(status.state)}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">{status.state === "ACTIVE" ? "Renews / due" : "Was due"}</p>
              <p className="text-sm font-medium">{new Date(status.currentPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Monthly price</p>
              <p className="text-sm font-medium">{status.currency} {status.amount.toLocaleString()}</p>
            </div>
          </div>

          {!status.billingConfigured ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              Online payment isn't set up yet — contact support to pay for your subscription.
            </p>
          ) : (
            <>
              <button
                onClick={startCheckout}
                disabled={paying}
                className="w-full bg-dhs-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-dhs-900 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CreditCard size={16} /> {paying ? "Starting checkout..." : `Pay ${status.currency} ${status.amount.toLocaleString()}`}
              </button>
              <p className="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5">
                <Smartphone size={12} /> Card and M-Pesa are both available on the payment page that opens next.
              </p>
            </>
          )}
        </Card>
      )}

      {status && status.state !== "ACTIVE" && (
        <p className="text-xs text-slate-400 mt-4 max-w-lg">
          {status.state === "GRACE"
            ? "You're in a 2-day grace period — the account still works normally, but will switch to read-only (no new sales, no changes) if payment isn't received in time."
            : "The account is currently read-only: you can still view inventory, past sales, and reports, but can't record new sales or make changes until payment is made."}
        </p>
      )}
    </div>
  );
}

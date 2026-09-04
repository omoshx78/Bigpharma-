import { useState, useEffect, useRef } from "react";
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
  mpesaAvailable: boolean;
}

interface MpesaQuote {
  kesAmount: number;
  rate: number;
  originalAmount: number;
  originalCurrency: string;
}

type MpesaPhase = "idle" | "waiting" | "success" | "failed";

const MPESA_POLL_MS = 3000;
const MPESA_TIMEOUT_MS = 90000; // give up after 90s of no confirmation

export default function Billing() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [params] = useSearchParams();
  const paidParam = params.get("paid");

  const [phone, setPhone] = useState("");
  const [mpesaPhase, setMpesaPhase] = useState<MpesaPhase>("idle");
  const [chargedKes, setChargedKes] = useState<number | null>(null);
  const [quote, setQuote] = useState<MpesaQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    api.get("/billing/status").then(setStatus).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load billing status"));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!status?.mpesaAvailable) return;
    api.get("/billing/mpesa/quote").then(setQuote).catch((err) => setQuoteError(err instanceof ApiError ? err.message : "Could not get a current exchange rate"));
  }, [status?.mpesaAvailable]);

  useEffect(() => {
    // Clean up any in-flight poll/timeout if the component unmounts mid-payment.
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startCheckout = async () => {
    setPaying(true);
    setError(null);
    try {
      const { link } = await api.post("/billing/checkout");
      window.location.href = link; // Flutterwave hosted checkout — card payment
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start checkout");
      setPaying(false);
    }
  };

  const startMpesa = async () => {
    if (!phone.trim()) return;
    setError(null);
    setMpesaPhase("waiting");
    try {
      const { checkoutRequestId, kesAmount } = await api.post("/billing/mpesa/checkout", { phoneNumber: phone.trim() });
      setChargedKes(kesAmount);

      pollRef.current = setInterval(async () => {
        try {
          const { status: pollStatus } = await api.get(`/billing/mpesa/status/${checkoutRequestId}`);
          if (pollStatus === "SUCCESSFUL") {
            stopPolling();
            setMpesaPhase("success");
            load();
          } else if (pollStatus === "FAILED") {
            stopPolling();
            setMpesaPhase("failed");
          }
        } catch {
          // transient network hiccup while polling — keep trying until the timeout
        }
      }, MPESA_POLL_MS);

      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setMpesaPhase((phase) => (phase === "waiting" ? "failed" : phase));
      }, MPESA_TIMEOUT_MS);
    } catch (err) {
      setMpesaPhase("idle");
      setError(err instanceof ApiError ? err.message : "Could not start M-Pesa payment");
    }
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  };

  const resetMpesa = () => {
    stopPolling();
    setMpesaPhase("idle");
    setChargedKes(null);
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
              <p className="text-sm font-medium">
                {new Date(status.currentPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                {status.state === "ACTIVE" && (() => {
                  const d = Math.ceil((new Date(status.currentPeriodEnd).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                  return <span className="text-xs text-slate-400 font-normal"> — {d <= 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}</span>;
                })()}
              </p>
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
            <div className="space-y-4">
              <div>
                <button
                  onClick={startCheckout}
                  disabled={paying}
                  className="w-full bg-dhs-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-dhs-900 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <CreditCard size={16} /> {paying ? "Starting checkout..." : `Pay by card — ${status.currency} ${status.amount.toLocaleString()}`}
                </button>
              </div>

              {status.mpesaAvailable && (
                <div className="pt-4 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5"><Smartphone size={13} /> Or pay directly with M-Pesa</p>

                  {status.currency !== "KES" && quote && mpesaPhase === "idle" && (
                    <p className="text-xs text-slate-400 mb-2">
                      Approximately <span className="font-medium text-slate-600">KES {quote.kesAmount.toLocaleString()}</span> at today's rate (1 {status.currency} ≈ {quote.rate.toFixed(2)} KES). The exact amount is fixed at the moment you send the prompt.
                    </p>
                  )}
                  {status.currency !== "KES" && quoteError && mpesaPhase === "idle" && (
                    <p className="text-xs text-rose-500 mb-2">{quoteError}</p>
                  )}

                  {mpesaPhase === "idle" && (
                    <div className="flex gap-2">
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="07XXXXXXXX"
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <button onClick={startMpesa} disabled={!phone.trim()} className="bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-emerald-800 disabled:opacity-50">
                        Send prompt
                      </button>
                    </div>
                  )}

                  {mpesaPhase === "waiting" && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                      Check <span className="font-medium">{phone}</span> for an M-Pesa prompt{chargedKes != null && <> for <span className="font-medium">KES {chargedKes.toLocaleString()}</span></>} and enter your PIN to complete payment. This page will update automatically.
                    </div>
                  )}

                  {mpesaPhase === "success" && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                      Payment confirmed — subscription updated.
                    </div>
                  )}

                  {mpesaPhase === "failed" && (
                    <div className="space-y-2">
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
                        We didn't get confirmation of that payment — it may have been cancelled or timed out. If money left your account, contact support before trying again.
                      </div>
                      <button onClick={resetMpesa} className="text-xs text-dhs-700 hover:underline">Try again</button>
                    </div>
                  )}
                </div>
              )}
            </div>
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

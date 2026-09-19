import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, Wallet, ShieldCheck, Receipt } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

const DEMO_EMAIL = "demo@dhspharmacy.com";
const DEMO_PASSWORD = "TryDHSPharmacy!";

const FEATURES = [
  { icon: Boxes, text: "Stock that updates itself \u2014 every sale and restock keeps your shelf counts accurate automatically." },
  { icon: Receipt, text: "A queue built for busy counters \u2014 order-taking and cashier work stay separate, so nothing leaves the shelf before it's paid for." },
  { icon: Wallet, text: "Get paid your way \u2014 cash, card, or M-Pesa, all built in." },
  { icon: ShieldCheck, text: "Staff accounts with real boundaries \u2014 admins, order-takers, and cashiers each see only what their role needs." },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemoCredentials = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left: pitch */}
      <div className="bg-gradient-to-br from-dhs-900 to-dhs-800 text-white lg:w-[58%] px-6 py-10 sm:px-12 lg:px-16 lg:py-16 flex flex-col justify-center">
        <div className="max-w-xl mx-auto lg:mx-0 lg:ml-auto lg:mr-16">
          <p className="text-sm font-medium text-dhs-200 mb-6">Digital Health Solutions</p>

          <h1 className="text-4xl sm:text-5xl font-black leading-[1.08] tracking-tight mb-5">
            Pharmacy management that fits how your team actually works.
          </h1>
          <p className="text-dhs-100 text-base sm:text-lg leading-relaxed mb-10 max-w-md">
            Inventory, sales, and staff — in one system your pharmacy can start using today.
          </p>

          <ul className="space-y-4 mb-10">
            {FEATURES.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3">
                <Icon size={18} className="text-dhs-300 shrink-0 mt-0.5" />
                <span className="text-sm text-dhs-100 leading-relaxed">{text}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-4 mb-10">
            <Link
              to="/signup"
              className="bg-white text-dhs-900 rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-dhs-50 transition"
            >
              Create your pharmacy account
            </Link>
            <span className="text-dhs-300 text-sm">No card required to start</span>
          </div>

          <div className="border-t border-white/15 pt-6">
            <p className="text-xs text-dhs-200 mb-2">Want to look around first? Try the free demo — real data, no setup:</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono text-dhs-100 mb-3">
              <span>{DEMO_EMAIL}</span>
              <span className="text-dhs-400">/</span>
              <span>{DEMO_PASSWORD}</span>
            </div>
            <button onClick={fillDemoCredentials} className="text-xs font-medium text-white underline hover:text-dhs-100">
              Fill in the demo login
            </button>
            <span className="text-dhs-500 mx-2 text-xs">or</span>
            <Link to="/guide" className="text-xs font-medium text-white underline hover:text-dhs-100">
              read the quick start guide
            </Link>
            <span className="text-dhs-500 mx-2 text-xs">or</span>
            <a href="https://www.youtube.com/watch?v=2QN5bzg939o" target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-white underline hover:text-dhs-100">
              watch a 2-min walkthrough
            </a>
          </div>
        </div>
      </div>

      {/* Right: sign in */}
      <div className="flex-1 flex items-center justify-center px-6 py-10 sm:px-12 lg:pl-16 lg:pr-24 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-900/5 p-8">
            <img src="/logo.png" alt="Digital Health Solutions" className="h-10 w-auto mb-5" />
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h2>
            <p className="text-sm text-slate-500 mb-6">Enter your pharmacy's login to continue</p>
            <form onSubmit={submit} className="space-y-4">
              <label className="text-sm block">
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-dhs-500 focus:border-transparent"
                  placeholder="you@pharmacy.com"
                />
              </label>
              <label className="text-sm block">
                Password
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-dhs-500 focus:border-transparent"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                disabled={submitting}
                className="w-full bg-dhs-800 text-white rounded-lg py-3 text-sm font-semibold hover:bg-dhs-900 disabled:opacity-50 transition"
              >
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </div>
          <p className="text-xs text-slate-400 mt-4 text-center">
            Setting up a new pharmacy?{" "}
            <Link to="/signup" className="text-dhs-700 font-medium hover:underline">
              Create an account
            </Link>
          </p>
          <p className="text-xs text-slate-400 mt-8 text-center">
            Questions or support: <a href="mailto:info@jazzmedia.co.ke" className="text-slate-600 hover:underline">info@jazzmedia.co.ke</a> / <a href="tel:+254787968586" className="text-slate-600 hover:underline">+254 787 968 586</a> / <a href="https://www.jazzmedia.co.ke" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline">jazzmedia.co.ke</a>
          </p>
        </div>
      </div>
    </div>
  );
}

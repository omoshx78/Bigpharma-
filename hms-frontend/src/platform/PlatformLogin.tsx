import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { usePlatformAuth } from "./PlatformAuthContext";
import { ApiError } from "../api/client";

export default function PlatformLogin() {
  const { login } = usePlatformAuth();
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
      navigate("/platform");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-8">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Platform</p>
        <p className="text-lg font-semibold text-white mb-6">Super Admin</p>
        <form onSubmit={submit} className="space-y-3">
          <label className="text-sm block text-slate-300">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-sm block text-slate-300">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            disabled={submitting}
            className="w-full bg-emerald-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

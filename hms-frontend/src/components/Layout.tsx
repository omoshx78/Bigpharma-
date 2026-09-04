import { NavLink, Outlet, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Wallet, Boxes, BarChart3, LogOut,
  KeyRound, ShieldCheck, ShieldAlert, Receipt, CreditCard, AlertTriangle,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { Role } from "../types";

const NAV: { to: string; label: string; icon: any; roles: Role[] | "all" }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: "all" },
  { to: "/new-sale", label: "New Sale", icon: ShoppingCart, roles: ["ORDER_TAKER"] },
  { to: "/cashier", label: "Cashier", icon: Wallet, roles: ["CASHIER"] },
  { to: "/sales", label: "Sales Lookup", icon: Receipt, roles: "all" },
  { to: "/inventory", label: "Inventory", icon: Boxes, roles: "all" },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["CASHIER", "ADMIN"] },
  { to: "/staff", label: "Staff", icon: ShieldCheck, roles: ["ADMIN"] },
  { to: "/audit-log", label: "Audit log", icon: ShieldAlert, roles: ["ADMIN"] },
  { to: "/billing", label: "Billing", icon: CreditCard, roles: ["ADMIN"] },
];

// How many days out to start showing an advance "renews soon" heads-up
// while the subscription is still ACTIVE (i.e. before it's even overdue).
const DUE_SOON_DAYS = 3;

function daysUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function Layout() {
  const { user, tenant, logout } = useAuth();
  const visible = NAV.filter((n) => n.roles === "all" || (user && (user.role === "ADMIN" || n.roles.includes(user.role))));
  const [billingState, setBillingState] = useState<{ state: "ACTIVE" | "GRACE" | "LOCKED"; currentPeriodEnd: string } | null>(null);

  useEffect(() => {
    if (user?.role !== "ADMIN") return;
    api.get("/billing/status").then(setBillingState).catch(() => {});
  }, [user?.role]);

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 flex">
      <aside className="w-56 shrink-0 bg-dhs-900 text-dhs-50 flex flex-col">
        <div className="px-4 py-5 border-b border-dhs-800 bg-white">
          <img src="/logo.png" alt="Digital Health Solutions" className="h-9 w-auto" />
          {tenant && <p className="text-xs text-slate-500 mt-1.5 truncate" title={tenant.name}>{tenant.name}</p>}
        </div>
        <nav className="flex-1 py-2">
          {visible.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition ${isActive ? "bg-dhs-800 text-white border-r-2 border-emerald-400" : "text-dhs-200 hover:bg-dhs-800/60"}`
                }
              >
                <Icon size={16} /> {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-dhs-800 text-xs">
          <p className="text-dhs-100 font-medium">{user?.name}</p>
          <p className="text-dhs-400 mb-2">{user?.role}</p>
          <Link to="/change-password" className="flex items-center gap-1.5 text-dhs-300 hover:text-white mb-1.5">
            <KeyRound size={13} /> Change password
          </Link>
          <button onClick={logout} className="flex items-center gap-1.5 text-dhs-300 hover:text-white">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {billingState && billingState.state === "LOCKED" && (
          <div className="px-6 py-2.5 text-sm flex items-center gap-2 bg-rose-50 text-rose-800 border-b border-rose-200">
            <AlertTriangle size={15} className="shrink-0" />
            Subscription payment overdue — the account is read-only until payment is made.
            <Link to="/billing" className="ml-auto font-medium underline shrink-0">Go to Billing</Link>
          </div>
        )}
        {billingState && billingState.state === "GRACE" && (
          <div className="px-6 py-2.5 text-sm flex items-center gap-2 bg-amber-50 text-amber-800 border-b border-amber-200">
            <AlertTriangle size={15} className="shrink-0" />
            Subscription payment is overdue — pay by {new Date(billingState.currentPeriodEnd).toLocaleDateString()} to avoid read-only mode.
            <Link to="/billing" className="ml-auto font-medium underline shrink-0">Go to Billing</Link>
          </div>
        )}
        {billingState && billingState.state === "ACTIVE" && daysUntil(billingState.currentPeriodEnd) <= DUE_SOON_DAYS && (
          <div className="px-6 py-2.5 text-sm flex items-center gap-2 bg-sky-50 text-sky-800 border-b border-sky-200">
            <AlertTriangle size={15} className="shrink-0" />
            {(() => {
              const d = daysUntil(billingState.currentPeriodEnd);
              return d <= 0 ? "Subscription renews today" : `Subscription renews in ${d} day${d === 1 ? "" : "s"} — ${new Date(billingState.currentPeriodEnd).toLocaleDateString()}`;
            })()}
            <Link to="/billing" className="ml-auto font-medium underline shrink-0">Go to Billing</Link>
          </div>
        )}
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

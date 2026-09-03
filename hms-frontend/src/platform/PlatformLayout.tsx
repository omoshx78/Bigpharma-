import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Receipt, Wallet, LogOut } from "lucide-react";
import { usePlatformAuth } from "./PlatformAuthContext";

const NAV = [
  { to: "/platform", label: "Dashboard", icon: LayoutDashboard },
  { to: "/platform/payments", label: "Payments", icon: Receipt },
  { to: "/platform/expenses", label: "Expenses", icon: Wallet },
];

export function PlatformLayout() {
  const { admin, logout } = usePlatformAuth();

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-56 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-4 py-5 border-b border-slate-800">
          <p className="text-xs uppercase tracking-wide text-slate-500">Platform</p>
          <p className="text-sm font-semibold text-white">Super Admin</p>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/platform"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition ${isActive ? "bg-slate-800 text-white border-r-2 border-emerald-400" : "text-slate-400 hover:bg-slate-800/60"}`
                }
              >
                <Icon size={16} /> {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 text-xs">
          <p className="text-slate-200 font-medium mb-2">{admin?.name}</p>
          <button onClick={logout} className="flex items-center gap-1.5 text-slate-400 hover:text-white">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Role } from "./types";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import NewSale from "./pages/NewSale";
import Cashier from "./pages/Cashier";
import SalesLookup from "./pages/SalesLookup";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import Staff from "./pages/Staff";
import AuditLog from "./pages/AuditLog";
import Billing from "./pages/Billing";
import ChangePassword from "./pages/ChangePassword";
import PrintReceipt from "./pages/PrintReceipt";
import PrintStock from "./pages/PrintStock";
import PrintReportDetail from "./pages/PrintReportDetail";

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && user.role !== "ADMIN" && !roles.includes(user.role)) {
    return (
      <div className="p-8 text-slate-500 text-sm">
        Your role ({user.role}) doesn't have access to this page. Ask an admin if you need it.
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <div className="p-8 text-sm text-slate-400">Loading...</div> : user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={loading ? <div className="p-8 text-sm text-slate-400">Loading...</div> : user ? <Navigate to="/" replace /> : <Signup />}
      />
      <Route
        path="/print/:saleId"
        element={
          <Guard>
            <PrintReceipt />
          </Guard>
        }
      />
      <Route
        path="/print/stock"
        element={
          <Guard>
            <PrintStock />
          </Guard>
        }
      />
      <Route
        path="/print/report"
        element={
          <Guard roles={["CASHIER"]}>
            <PrintReportDetail />
          </Guard>
        }
      />
      <Route
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/new-sale"
          element={
            <Guard roles={["ORDER_TAKER"]}>
              <NewSale />
            </Guard>
          }
        />
        <Route
          path="/cashier"
          element={
            <Guard roles={["CASHIER"]}>
              <Cashier />
            </Guard>
          }
        />
        <Route path="/sales" element={<SalesLookup />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route
          path="/reports"
          element={
            <Guard roles={["CASHIER"]}>
              <Reports />
            </Guard>
          }
        />
        <Route
          path="/staff"
          element={
            <Guard roles={["ADMIN"]}>
              <Staff />
            </Guard>
          }
        />
        <Route
          path="/audit-log"
          element={
            <Guard roles={["ADMIN"]}>
              <AuditLog />
            </Guard>
          }
        />
        <Route
          path="/billing"
          element={
            <Guard roles={["ADMIN"]}>
              <Billing />
            </Guard>
          }
        />
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

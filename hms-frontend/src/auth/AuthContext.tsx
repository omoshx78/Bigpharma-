import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setToken, getToken } from "../api/client";
import { User, Tenant } from "../types";

interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (businessName: string, adminName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const TENANT_STORAGE_KEY = "dhs_pharmacy_tenant";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(() => {
    const raw = localStorage.getItem(TENANT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const me = await api.get("/auth/me");
          setUser(me);
        } catch {
          setToken(null);
          setTenant(null);
          localStorage.removeItem(TENANT_STORAGE_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const applySession = (res: { token: string; user: User; tenant: Tenant }) => {
    setToken(res.token);
    setUser(res.user);
    setTenant(res.tenant);
    localStorage.setItem(TENANT_STORAGE_KEY, JSON.stringify(res.tenant));
  };

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    applySession(res);
  };

  const signup = async (businessName: string, adminName: string, email: string, password: string) => {
    const res = await api.post("/auth/signup", { businessName, adminName, email, password });
    applySession(res);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setTenant(null);
    localStorage.removeItem(TENANT_STORAGE_KEY);
  };

  return <AuthContext.Provider value={{ user, tenant, loading, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

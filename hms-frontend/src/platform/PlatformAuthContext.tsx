import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { platformApi, setPlatformToken, getPlatformToken } from "./api";

interface PlatformAdmin {
  id: string;
  name: string;
  email?: string;
}

interface PlatformAuthContextValue {
  admin: PlatformAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getPlatformToken()) {
        try {
          setAdmin(await platformApi.get("/platform/auth/me"));
        } catch {
          setPlatformToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await platformApi.post("/platform/auth/login", { email, password });
    setPlatformToken(res.token);
    setAdmin(res.admin);
  };

  const logout = () => {
    setPlatformToken(null);
    setAdmin(null);
  };

  return <PlatformAuthContext.Provider value={{ admin, loading, login, logout }}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error("usePlatformAuth must be used within PlatformAuthProvider");
  return ctx;
}

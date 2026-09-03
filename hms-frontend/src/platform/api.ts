import { ApiError } from "../api/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Deliberately a SEPARATE storage key and module-level token from the
// tenant api client (../api/client.ts) — a platform admin token and a
// tenant session token can coexist in the same browser without
// overwriting each other, e.g. if you're testing a tenant account and
// the platform dashboard side by side.
let token: string | null = localStorage.getItem("dhs_platform_token");

export function setPlatformToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("dhs_platform_token", t);
  else localStorage.removeItem("dhs_platform_token");
}

export function getPlatformToken() {
  return token;
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body (e.g. 204, or a CSV download — see downloadCsv below)
  }

  if (!res.ok) {
    if (res.status === 401) setPlatformToken(null);
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export const platformApi = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  delete: (path: string) => request(path, { method: "DELETE" }),
};

/** Triggers a browser download for a CSV export endpoint (?format=csv), reusing the same auth header. */
export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(`Could not download ${filename}`, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

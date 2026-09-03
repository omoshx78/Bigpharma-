import "dotenv/config";
import express from "express";
import "express-async-errors";
import cors from "cors";
import path from "path";
import fs from "fs";
import authRoutes from "./routes/auth.routes";
import inventoryRoutes from "./routes/inventory.routes";
import salesRoutes from "./routes/sales.routes";
import queueRoutes from "./routes/queue.routes";
import reportRoutes from "./routes/reports.routes";
import billingRoutes from "./routes/billing.routes";
import platformRoutes from "./routes/platform.routes";
import { subscriptionGate } from "./middleware/subscriptionGate";

const app = express();

const explicitOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim().replace(/\/+$/, ""))
  : [];

// Optional: once a real domain is registered for per-tenant subdomains
// (e.g. bigpharma.dhspharmacy.com), set APP_BASE_DOMAIN=dhspharmacy.com
// and every https://<anything>.dhspharmacy.com origin is allowed
// automatically — no code change or redeploy needed per tenant.
// Leaving it unset preserves today's exact-match-only behavior.
const wildcardBaseDomain = process.env.APP_BASE_DOMAIN?.trim().replace(/^\.+/, "");

function isAllowedOrigin(origin: string): boolean {
  if (explicitOrigins.length === 0 && !wildcardBaseDomain) return true; // no restriction configured
  if (explicitOrigins.includes(origin)) return true;
  if (wildcardBaseDomain) {
    try {
      const hostname = new URL(origin).hostname;
      if (hostname === wildcardBaseDomain || hostname.endsWith(`.${wildcardBaseDomain}`)) return true;
    } catch {
      // malformed origin header, fall through to reject
    }
  }
  return false;
}

console.log("CORS explicit origins:", explicitOrigins.length ? explicitOrigins : "(none)");
console.log("CORS wildcard base domain:", wildcardBaseDomain || "(none — subdomains not enabled yet)");

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (server-to-server, curl, health checks) — allow.
      if (!origin) return callback(null, true);
      callback(null, isAllowedOrigin(origin));
    },
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Soft-locks write access for tenants whose subscription has lapsed
// past its grace period. Mounted globally so it's enforced everywhere
// automatically, including any route added later — see the file for
// the exact list of always-exempt paths (billing, login, health).
app.use(subscriptionGate);

app.use("/auth", authRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales", salesRoutes);
app.use("/queue", queueRoutes);
app.use("/reports", reportRoutes);
app.use("/billing", billingRoutes);
app.use("/platform", platformRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err?.code === "P2002") return res.status(409).json({ error: "This conflicts with an existing record (duplicate entry). Refresh and try again." });
  if (err?.code === "P2025") return res.status(404).json({ error: "That record no longer exists — it may have been changed by someone else. Refresh and try again." });
  if (err?.code === "P2003") return res.status(400).json({ error: "This action refers to a record that no longer exists. Refresh and try again." });
  res.status(500).json({ error: "Something went wrong on the server. If this keeps happening, check the server logs." });
});

// Serves the built frontend directly when present (on-premise deployments) —
// see hms-frontend build step in WINDOWS_ONPREM_SETUP.md. Cloud deployments
// (Render/Vercel) simply won't have this folder, so this has no effect there.
const frontendDist = path.join(__dirname, "..", "..", "hms-frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`DHS Pharmacy API listening on port ${port}`));

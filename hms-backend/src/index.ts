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

const app = express();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim().replace(/\/+$/, ""))
  : "*";

console.log("CORS allowed origins:", corsOrigin);

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales", salesRoutes);
app.use("/queue", queueRoutes);
app.use("/reports", reportRoutes);

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

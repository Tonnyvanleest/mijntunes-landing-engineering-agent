import express from "express";
import { getLandingStatus, getLandingRecentFailures } from "./github.js";

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "MijnTunes Landing Engineering Agent",
    version: "0.1.0",
    status: "online",
    targetRepository: process.env.LANDING_GITHUB_REPOSITORY || "Tonnyvanleest/mijntunes-landing",
    capabilities: ["get_landing_status", "get_landing_recent_failures"]
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mijntunes-landing-engineering-agent", timestamp: new Date().toISOString() });
});

app.get("/api/landing/status", async (_req, res) => {
  try {
    res.json({ ok: true, data: await getLandingStatus() });
  } catch (error) {
    console.error("get_landing_status failed", error);
    res.status(502).json({ ok: false, capability: "get_landing_status", error: error.message });
  }
});

app.get("/api/landing/failures", async (req, res) => {
  try {
    const requested = Number.parseInt(String(req.query.limit || "10"), 10);
    const limit = Number.isFinite(requested) ? requested : 10;
    res.json({ ok: true, data: await getLandingRecentFailures(limit) });
  } catch (error) {
    console.error("get_landing_recent_failures failed", error);
    res.status(502).json({ ok: false, capability: "get_landing_recent_failures", error: error.message });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`MijnTunes Landing Engineering Agent listening on port ${port}`);
});

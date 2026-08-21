import express from "express";
import { getLandingStatus, getLandingRecentFailures } from "./github.js";
import { createLandingJob, getLandingJob, runLandingJob } from "./jobs.js";
import { handleMcp } from "./mcp.js";

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "MijnTunes Landing Engineering Agent",
    version: "0.3.0",
    status: "online",
    targetRepository: process.env.LANDING_GITHUB_REPOSITORY || "Tonnyvanleest/mijntunes-landing",
    mcpEndpoint: "/mcp",
    capabilities: [
      "get_landing_status",
      "get_landing_recent_failures",
      "create_landing_job",
      "get_landing_job",
      "run_landing_job"
    ]
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

app.post("/api/landing/jobs", (req, res) => {
  try {
    const job = createLandingJob(req.body?.instruction);
    res.status(201).json({ ok: true, data: job });
  } catch (error) {
    res.status(400).json({ ok: false, capability: "create_landing_job", error: error.message });
  }
});

app.get("/api/landing/jobs/:id", (req, res) => {
  const job = getLandingJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, capability: "get_landing_job", error: "job not found" });
  res.json({ ok: true, data: job });
});

app.post("/api/landing/jobs/:id/run", async (req, res) => {
  try {
    const job = await runLandingJob(req.params.id);
    res.json({ ok: true, data: job });
  } catch (error) {
    console.error("run_landing_job failed", error);
    const job = getLandingJob(req.params.id);
    res.status(job ? 502 : 404).json({ ok: false, capability: "run_landing_job", error: error.message, data: job });
  }
});

app.all("/mcp", async (req, res) => {
  try {
    await handleMcp(req, res);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed", detail: error.message });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`MijnTunes Landing Engineering Agent listening on port ${port}`);
});

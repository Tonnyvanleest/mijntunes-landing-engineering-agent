import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getLandingStatus, getLandingRecentFailures } from "./github.js";
import { createLandingJob, getLandingJob, runLandingJob } from "./jobs.js";

function result(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function buildServer() {
  const server = new McpServer({
    name: "mijntunes-landing-engineering-agent",
    version: "0.3.0"
  });

  server.tool(
    "get_landing_status",
    "Read the current GitHub and release status of the MijnTunes landing repository. Read-only.",
    {},
    async () => result(await getLandingStatus())
  );

  server.tool(
    "get_landing_recent_failures",
    "Read recent failed GitHub Actions runs for the MijnTunes landing repository. Read-only.",
    { limit: z.number().int().min(1).max(20).optional() },
    async ({ limit }) => result(await getLandingRecentFailures(limit || 10))
  );

  server.tool(
    "create_landing_job",
    "Create a pending engineering job scoped strictly to Tonnyvanleest/mijntunes-landing. This does not modify the landing repository yet.",
    { instruction: z.string().min(10).max(12000) },
    async ({ instruction }) => result(createLandingJob(instruction))
  );

  server.tool(
    "get_landing_job",
    "Get the current state and result of a landing engineering job.",
    { id: z.string().uuid() },
    async ({ id }) => {
      const job = getLandingJob(id);
      if (!job) throw new Error("job not found");
      return result(job);
    }
  );

  server.tool(
    "run_landing_job",
    "Execute one previously created pending landing job. This can modify and commit to Tonnyvanleest/mijntunes-landing main.",
    { id: z.string().uuid() },
    async ({ id }) => result(await runLandingJob(id))
  );

  return server;
}

export async function handleMcp(req, res) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

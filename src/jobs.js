import crypto from "node:crypto";

const API = "https://api.github.com";
const OPENAI_API = "https://api.openai.com/v1/responses";
const HARD_TARGET = "Tonnyvanleest/mijntunes-landing";
const jobs = new Map();

function repoParts() {
  const full = process.env.LANDING_GITHUB_REPOSITORY || HARD_TARGET;
  if (full !== HARD_TARGET) {
    throw new Error(`Repository boundary violation: expected ${HARD_TARGET}`);
  }
  const [owner, repo] = full.split("/");
  return { owner, repo, full };
}

async function gh(path, { method = "GET", body } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");

  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mijntunes-landing-engineering-agent",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}

function openAIText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function askOpenAI(instruction) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: instruction
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  const text = openAIText(payload);
  if (!text) throw new Error("OpenAI returned no text output");
  return text;
}

function parseJson(text, label) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${label} was not valid JSON: ${cleaned.slice(0, 1000)}`);
  }
}

function isCandidate(path, size) {
  if (!path || size > 250000) return false;
  if (/(^|\/)(node_modules|\.next|dist|build|coverage|public\/audio)(\/|$)/.test(path)) return false;
  if (/\.(png|jpe?g|gif|webp|ico|mp3|wav|zip|pdf|woff2?|ttf|eot|lock)$/i.test(path)) return false;
  return /(^|\/)(package\.json|tsconfig\.json|next\.config\.[^/]+|vercel\.json|README\.md)$|\.(js|jsx|ts|tsx|css|scss|json|md|html|svg)$/i.test(path);
}

async function readFile(owner, repo, path, ref) {
  const file = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`);
  if (file.type !== "file" || file.encoding !== "base64") throw new Error(`Cannot read ${path} as a text file`);
  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function publicJob(job) {
  const { instruction, error, ...safe } = job;
  return { ...safe, instruction, error: error || null };
}

export function createLandingJob(instruction) {
  const text = String(instruction || "").trim();
  if (text.length < 10) throw new Error("instruction must contain at least 10 characters");
  if (text.length > 12000) throw new Error("instruction is too long");

  repoParts();
  const id = crypto.randomUUID();
  const job = {
    id,
    repository: HARD_TARGET,
    instruction: text,
    status: "pending",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    baseSha: null,
    commitSha: null,
    changedFiles: [],
    summary: null,
    error: null
  };
  jobs.set(id, job);
  return publicJob(job);
}

export function getLandingJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export async function runLandingJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error("job not found");
  if (job.status !== "pending") throw new Error(`job cannot run from status ${job.status}`);

  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    const { owner, repo } = repoParts();
    const branch = await gh(`/repos/${owner}/${repo}/branches/main`);
    const baseSha = branch.commit.sha;
    job.baseSha = baseSha;

    const commit = await gh(`/repos/${owner}/${repo}/git/commits/${baseSha}`);
    const baseTreeSha = commit.tree.sha;
    const tree = await gh(`/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
    const candidates = (tree.tree || [])
      .filter((item) => item.type === "blob" && isCandidate(item.path, item.size || 0))
      .map((item) => ({ path: item.path, size: item.size || 0 }))
      .slice(0, 800);

    const selectionText = await askOpenAI([
      "You are selecting repository files needed to implement a web landing-site task.",
      `Repository is strictly ${HARD_TARGET}.`,
      "Return ONLY JSON in this exact shape: {\"paths\":[\"path\"]}.",
      "Choose at most 12 existing text files. Prefer the smallest sufficient set.",
      `TASK:\n${job.instruction}`,
      `FILES:\n${JSON.stringify(candidates)}`
    ].join("\n\n"));

    const selection = parseJson(selectionText, "file selection");
    const allowed = new Set(candidates.map((item) => item.path));
    const selectedPaths = [...new Set(Array.isArray(selection.paths) ? selection.paths : [])]
      .filter((path) => allowed.has(path))
      .slice(0, 12);
    if (!selectedPaths.length) throw new Error("OpenAI selected no valid repository files");

    const files = [];
    let totalChars = 0;
    for (const path of selectedPaths) {
      const content = await readFile(owner, repo, path, baseSha);
      totalChars += content.length;
      if (totalChars > 600000) throw new Error("Selected source context is too large");
      files.push({ path, content });
    }

    const editText = await askOpenAI([
      "You are the implementation engine for the MijnTunes.nl landing-site repository.",
      `You may modify ONLY ${HARD_TARGET}.`,
      "Implement the task completely but minimally. Preserve existing design and behavior unless the task requires a change.",
      "Return ONLY valid JSON with this exact shape:",
      "{\"summary\":\"short summary\",\"commitMessage\":\"imperative commit message\",\"changes\":[{\"path\":\"existing/or/new/path\",\"content\":\"complete replacement file content\"}]}",
      "Every change must contain the COMPLETE final file contents. Do not use patches. Do not delete files. Do not include secrets.",
      "New files are allowed only when clearly needed. Do not touch lockfiles, generated files, binaries, deployment secrets or other repositories.",
      `TASK:\n${job.instruction}`,
      `SOURCE FILES:\n${JSON.stringify(files)}`
    ].join("\n\n"));

    const edit = parseJson(editText, "implementation");
    const changes = Array.isArray(edit.changes) ? edit.changes : [];
    if (!changes.length) throw new Error("Implementation contained no changes");
    if (changes.length > 20) throw new Error("Implementation attempted too many file changes");

    const treeEntries = [];
    const changedFiles = [];
    for (const change of changes) {
      const path = String(change.path || "").trim();
      const content = typeof change.content === "string" ? change.content : null;
      if (!path || content === null) throw new Error("Invalid file change returned by OpenAI");
      if (path.startsWith("/") || path.includes("..") || /(^|\/)\.env($|\.)/.test(path)) throw new Error(`Blocked path: ${path}`);
      if (/\.(png|jpe?g|gif|webp|ico|mp3|wav|zip|pdf|woff2?|ttf|eot|lock)$/i.test(path)) throw new Error(`Blocked binary/generated path: ${path}`);
      if (content.length > 350000) throw new Error(`File too large: ${path}`);

      const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: { content, encoding: "utf-8" }
      });
      treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      changedFiles.push(path);
    }

    const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: { base_tree: baseTreeSha, tree: treeEntries }
    });

    const newCommit = await gh(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: {
        message: String(edit.commitMessage || "Update MijnTunes landing site").slice(0, 200),
        tree: newTree.sha,
        parents: [baseSha]
      }
    });

    const latestBranch = await gh(`/repos/${owner}/${repo}/branches/main`);
    if (latestBranch.commit.sha !== baseSha) {
      throw new Error(`main moved during job; expected ${baseSha}, found ${latestBranch.commit.sha}`);
    }

    await gh(`/repos/${owner}/${repo}/git/refs/heads/main`, {
      method: "PATCH",
      body: { sha: newCommit.sha, force: false }
    });

    job.status = "completed";
    job.commitSha = newCommit.sha;
    job.changedFiles = changedFiles;
    job.summary = String(edit.summary || "Landing-site job completed");
    job.completedAt = new Date().toISOString();
    return publicJob(job);
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    throw error;
  }
}

import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { c, fail, out, success, table } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

export async function jobsCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  switch (sub) {
    case undefined:
    case "list":
      return list(api, args, asJson);
    case "show":
    case "get":
      return show(api, args, asJson);
    case "search":
      return search(api, args, asJson);
    case "mine":
      return mine(api, args, asJson, auth.agentId);
    case "start":
      return start(api, args, asJson);
    case "submit":
      return submit(api, args, asJson);
    case "approve":
      return approve(api, args, asJson);
    case "reject":
      return reject(api, args, asJson);
    case "cancel":
      return cancel(api, args, asJson);
    case "events":
      return events(api, args, asJson);
    default:
      fail(`Unknown jobs subcommand: ${sub}`);
      process.exit(2);
  }
}

async function list(api: Api, args: ParsedArgs, asJson: boolean) {
  const status = flag(args.options, ["status"]) ?? "OPEN";
  const vertical = flag(args.options, ["vertical"]);
  const limitStr = flag(args.options, ["limit"]);
  const cursor = flag(args.options, ["cursor"]);
  const limit = limitStr ? Number(limitStr) : 20;
  const data = (await api.request("GET", "/jobs", { query: { status, vertical, limit, cursor } })) as any[];
  if (asJson) return out(data, true);
  if (!data?.length) return out("(no jobs)", false);
  const rows = data.map((j) => ({
    id: j.id?.slice(0, 8),
    title: truncate(j.title, 50),
    vertical: j.vertical ?? j.template?.vertical ?? "—",
    "USDC": j.budgetUsdc,
    status: j.status,
    deadline: humanDate(j.deadlineAt),
  }));
  table(rows, ["id", "title", "vertical", "USDC", "status", "deadline"]);
}

async function show(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs show <jobId>");
    process.exit(2);
  }
  const job = await api.request("GET", `/jobs/${encodeURIComponent(id)}`);
  out(job, asJson);
}

async function search(api: Api, args: ParsedArgs, asJson: boolean) {
  const q = flag(args.options, ["q", "query"]) ?? args.positional.join(" ").trim();
  if (!q) {
    fail("Usage: molt jobs search <query>");
    process.exit(2);
  }
  const data = await api.request("GET", "/jobs", { query: { q, limit: 50 } });
  out(data, asJson);
}

async function mine(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? defaultAgentId;
  if (!agentId) {
    fail("Set --agent-id or run `molt auth login` to set a default.");
    process.exit(2);
  }
  const data = await api.request("GET", `/agents/${encodeURIComponent(agentId)}/jobs`);
  out(data, asJson);
}

async function start(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs start <jobId>");
    process.exit(2);
  }
  const job = await api.request("PATCH", `/jobs/${encodeURIComponent(id)}/start`);
  if (!asJson) success(`Started job ${id}`);
  out(job, asJson);
}

async function submit(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs submit <jobId> --output <json|@file.json> [--proof-hash <hash>]");
    process.exit(2);
  }
  const outputRaw = flag(args.options, ["output"]);
  if (!outputRaw) {
    fail("--output is required (JSON string or @path/to/file.json)");
    process.exit(2);
  }
  const outputData = await loadJsonArg(outputRaw);
  const proofHash = flag(args.options, ["proof-hash"]);
  const job = await api.request("PATCH", `/jobs/${encodeURIComponent(id)}/submit`, {
    body: { outputData, proofHash },
  });
  if (!asJson) success(`Submitted job ${id}`);
  out(job, asJson);
}

async function approve(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs approve <jobId>");
    process.exit(2);
  }
  const job = await api.request("PATCH", `/jobs/${encodeURIComponent(id)}/approve`);
  if (!asJson) success(`Approved job ${id} — escrow released.`);
  out(job, asJson);
}

async function reject(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  const reason = flag(args.options, ["reason"]);
  if (!id || !reason) {
    fail("Usage: molt jobs reject <jobId> --reason <text>");
    process.exit(2);
  }
  const job = await api.request("PATCH", `/jobs/${encodeURIComponent(id)}/reject`, { body: { reason } });
  if (!asJson) success(`Rejected job ${id}`);
  out(job, asJson);
}

async function cancel(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs cancel <jobId>");
    process.exit(2);
  }
  const job = await api.request("PATCH", `/jobs/${encodeURIComponent(id)}/cancel`);
  if (!asJson) success(`Cancelled job ${id}`);
  out(job, asJson);
}

async function events(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt jobs events <jobId>");
    process.exit(2);
  }
  const data = await api.request("GET", `/jobs/${encodeURIComponent(id)}/events`);
  out(data, asJson);
}

async function loadJsonArg(value: string): Promise<unknown> {
  if (value.startsWith("@")) {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(value.slice(1), "utf8");
    return JSON.parse(raw);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function truncate(s: string | undefined, n: number) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function humanDate(iso?: string) {
  if (!iso) return c.dim("—");
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

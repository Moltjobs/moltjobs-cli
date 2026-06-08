import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { fail, out, success, table } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

export async function agentCommand(sub: string | undefined, args: ParsedArgs) {
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
    case "me":
      return me(api, asJson);
    case "register":
      return register(api, args, asJson);
    case "heartbeat":
      return heartbeat(api, args, asJson, auth.agentId);
    case "api-keys":
      return apiKeys(api, args, asJson, auth.agentId);
    default:
      fail(`Unknown agent subcommand: ${sub}`);
      process.exit(2);
  }
}

async function list(api: Api, args: ParsedArgs, asJson: boolean) {
  const vertical = flag(args.options, ["vertical"]);
  const limit = flag(args.options, ["limit"]);
  const data = (await api.request("GET", "/agents", {
    query: { vertical, limit: limit ? Number(limit) : 20, sort: "reputation" },
  })) as any[];
  if (asJson) return out(data, true);
  if (!data?.length) return out("(no agents)", false);
  table(
    data.map((a) => ({
      id: a.id,
      name: a.name,
      vertical: a.vertical,
      reputation: a.reputation ?? "—",
      jobs: a.completedJobs ?? a.jobsCompleted ?? 0,
      status: a.status,
    })),
    ["id", "name", "vertical", "reputation", "jobs", "status"],
  );
}

async function show(api: Api, args: ParsedArgs, asJson: boolean) {
  const id = args.positional[0];
  if (!id) {
    fail("Usage: molt agent show <agentId>");
    process.exit(2);
  }
  const a = await api.request("GET", `/agents/${encodeURIComponent(id)}`);
  out(a, asJson);
}

async function me(api: Api, asJson: boolean) {
  const me = await api.request("GET", "/agents/me");
  out(me, asJson);
}

async function register(api: Api, args: ParsedArgs, asJson: boolean) {
  const agentHandle = args.positional[0] ?? flag(args.options, ["handle"]);
  const name = flag(args.options, ["name"]);
  const vertical = flag(args.options, ["vertical"]);
  const ownerEmail = flag(args.options, ["owner-email"]);
  const description = flag(args.options, ["description"]);
  if (!agentHandle || !name || !vertical || !ownerEmail) {
    fail(
      "Usage: molt agent register <handle> --name <text> --vertical <DATA|LEAD_GEN|...> --owner-email <email> [--description <text>]",
    );
    process.exit(2);
  }
  const r = await api.request("POST", "/agent-signups", {
    body: { agentHandle, name, vertical, ownerEmail, description },
  });
  if (!asJson) success(`Agent signup created. Check ${ownerEmail} for the claim link.`);
  out(r, asJson);
}

async function heartbeat(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? args.positional[0] ?? defaultAgentId;
  if (!agentId) {
    fail("Set --agent-id or `molt auth login`.");
    process.exit(2);
  }
  const r = await api.request("POST", `/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    body: { statusReport: flag(args.options, ["status"]) },
  });
  if (!asJson) success(`Heartbeat sent for ${agentId}`);
  out(r, asJson);
}

async function apiKeys(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const sub = args.positional[0];
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? defaultAgentId;
  if (!agentId) {
    fail("Set --agent-id or `molt auth login`.");
    process.exit(2);
  }
  if (sub === "list" || !sub) {
    const keys = await api.request("GET", `/agents/${encodeURIComponent(agentId)}/api-keys`);
    out(keys, asJson);
    return;
  }
  if (sub === "create") {
    const name = flag(args.options, ["name"]);
    if (!name) {
      fail("Usage: molt agent api-keys create --name <label>");
      process.exit(2);
    }
    const k = await api.request("POST", `/agents/${encodeURIComponent(agentId)}/api-keys`, {
      body: { name },
    });
    if (!asJson) success("API key created. Store rawKey now — it won't be shown again.");
    out(k, asJson);
    return;
  }
  if (sub === "revoke") {
    const keyId = args.positional[1];
    if (!keyId) {
      fail("Usage: molt agent api-keys revoke <keyId>");
      process.exit(2);
    }
    const r = await api.request("POST", `/agents/${encodeURIComponent(agentId)}/api-keys/${encodeURIComponent(keyId)}/revoke`);
    if (!asJson) success(`Revoked ${keyId}`);
    out(r, asJson);
    return;
  }
  fail(`Unknown api-keys subcommand: ${sub}`);
  process.exit(2);
}

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Api } from "../util/api.js";
import { clearCredentials, getConfigPath, readCredentials, writeCredentials } from "../util/credentials.js";
import { c, fail, info, out, success } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

export async function authCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  switch (sub) {
    case undefined:
    case "status":
      return status(asJson);
    case "login":
      return login(args, asJson);
    case "logout":
      return logout(asJson);
    case "whoami":
      return whoami(asJson);
    case "where":
      out({ path: getConfigPath() }, asJson);
      return;
    default:
      fail(`Unknown auth subcommand: ${sub}`);
      process.exit(2);
  }
}

async function status(asJson: boolean) {
  const creds = await readCredentials();
  if (!creds.apiKey) {
    if (asJson) {
      out({ authenticated: false }, true);
    } else {
      info(`Not signed in. Run ${c.bold("molt auth login")}.`);
    }
    return;
  }
  const redacted = creds.apiKey.slice(0, 8) + "…" + creds.apiKey.slice(-4);
  if (asJson) {
    out({ authenticated: true, apiKey: redacted, agentId: creds.agentId, apiUrl: creds.apiUrl, configFile: getConfigPath() }, true);
  } else {
    success(`Signed in (key ${c.cyan(redacted)})`);
    if (creds.agentId) info(`Default agent: ${c.bold(creds.agentId)}`);
    if (creds.apiUrl) info(`API: ${creds.apiUrl}`);
    info(`Config: ${getConfigPath()}`);
  }
}

async function login(args: ParsedArgs, asJson: boolean) {
  let apiKey = flag(args.options, ["api-key", "key"]);
  const agentId = flag(args.options, ["agent-id", "agent"]);
  const apiUrl = flag(args.options, ["api-url"]);

  if (!apiKey) {
    if (!input.isTTY) {
      fail("--api-key is required when not running in a TTY. Get one at https://dashboard.moltjobs.io → Agent → API Keys.");
      process.exit(2);
    }
    const rl = readline.createInterface({ input, output });
    info("Get an API key at https://dashboard.moltjobs.io → Agent → API Keys");
    apiKey = (await rl.question("Paste your MoltJobs API key (mj_live_…): ")).trim();
    rl.close();
  }

  if (!apiKey.startsWith("mj_")) {
    fail(`That doesn't look like a MoltJobs key. Expected prefix mj_live_… or mj_test_…`);
    process.exit(2);
  }

  // Validate by calling /agents/me
  const api = new Api({ apiKey, baseUrl: apiUrl });
  try {
    const me = (await api.request<any>("GET", "/agents/me")) as any;
    await writeCredentials({ apiKey, agentId: agentId ?? me?.id, apiUrl });
    if (asJson) {
      out({ ok: true, agent: me, configFile: getConfigPath() }, true);
    } else {
      success(`Signed in as ${c.bold(me?.name ?? me?.id ?? "agent")} (${me?.id ?? "?"})`);
      info(`Credentials stored at ${getConfigPath()}`);
      info(`Next: try ${c.bold("molt jobs list")} or ${c.bold("molt mcp install claude")}.`);
    }
  } catch (err) {
    fail(`Login failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function logout(asJson: boolean) {
  await clearCredentials();
  if (asJson) out({ ok: true }, true);
  else success("Signed out. Credentials removed.");
}

async function whoami(asJson: boolean) {
  const creds = await readCredentials();
  if (!creds.apiKey) {
    fail("Not signed in.");
    process.exit(1);
  }
  const api = new Api({ apiKey: creds.apiKey, baseUrl: creds.apiUrl });
  const me = await api.request("GET", "/agents/me");
  out(me, asJson);
}

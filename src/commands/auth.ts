import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { Api } from "../util/api.js";
import { clearCredentials, getConfigPath, readCredentials, writeCredentials } from "../util/credentials.js";
import { c, fail, info, out, success } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

const DEFAULT_BASE = "https://api.moltjobs.io/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* best effort */
  }
}

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
  if (creds.accessToken && creds.authType === "oauth") {
    if (asJson) {
      out({ authenticated: true, method: "oauth", clientId: creds.clientId, apiUrl: creds.apiUrl, configFile: getConfigPath() }, true);
    } else {
      success(`Signed in via OAuth (browser session)`);
      info(`Manage or revoke at ${c.bold("https://app.moltjobs.io/settings/connected-apps")}`);
      info(`Config: ${getConfigPath()}`);
    }
    return;
  }
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
  const apiKey = flag(args.options, ["api-key", "key"]);
  const agentId = flag(args.options, ["agent-id", "agent"]);
  const apiUrl = flag(args.options, ["api-url"]);

  // Default: browser-based OAuth device flow (no manual key to paste).
  // Opt into a static agent API key with `--api-key <key>`.
  if (!apiKey) {
    return deviceLogin(apiUrl, asJson);
  }

  if (!apiKey.startsWith("mj_")) {
    fail(`That doesn't look like a MoltJobs key. Expected prefix mj_live_… or mj_test_…`);
    process.exit(2);
  }

  // Validate by calling /agents/me
  const api = new Api({ apiKey, baseUrl: apiUrl });
  try {
    const me = (await api.request<any>("GET", "/agents/me")) as any;
    await writeCredentials({ apiKey, agentId: agentId ?? me?.id, apiUrl, authType: "apikey", accessToken: undefined, refreshToken: undefined });
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

// OAuth 2.0 Device Authorization Grant — authorize the CLI in the browser,
// no key to copy. One grant the user can revoke from the dashboard.
async function deviceLogin(apiUrl: string | undefined, asJson: boolean) {
  const base = (apiUrl ?? process.env.MOLTJOBS_API_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as any };
  };

  try {
    const reg = await postJson("/oauth/register", { client_name: "MoltJobs CLI" });
    const clientId = reg.json.client_id as string;
    if (!clientId) throw new Error("client registration failed");

    const scope =
      "profile agents:read agents:write jobs:read jobs:write bids:write wallet:read evals:write";
    const dev = await postJson("/oauth/device_authorization", { client_id: clientId, scope });
    const { device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in } = dev.json;
    if (!device_code) throw new Error("device authorization failed");

    const url = verification_uri_complete || verification_uri;
    if (!asJson) {
      info(`\n  Open ${c.bold(url)}`);
      info(`  and confirm the code: ${c.cyan(user_code)}\n`);
      info("  Waiting for authorization…");
      openBrowser(url);
    } else {
      out({ verification_uri: url, user_code }, true);
    }

    let pollMs = (interval || 5) * 1000;
    const deadline = Date.now() + (expires_in || 600) * 1000;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const tok = await postJson("/oauth/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
        client_id: clientId,
      });
      if (tok.ok && tok.json.access_token) {
        await writeCredentials({
          accessToken: tok.json.access_token,
          refreshToken: tok.json.refresh_token,
          clientId,
          apiUrl,
          authType: "oauth",
          apiKey: undefined,
        });
        const me = await fetch(`${base}/auth/me`, {
          headers: { Authorization: `Bearer ${tok.json.access_token}` },
        })
          .then((r) => r.json())
          .catch(() => null);
        const user = me?.data || me || {};
        if (asJson) {
          out({ ok: true, user, configFile: getConfigPath() }, true);
        } else {
          success(`Authorized as ${c.bold(user.email || user.displayName || "your account")}`);
          info(`Session stored at ${getConfigPath()}`);
          info(`Manage or revoke access at ${c.bold("https://app.moltjobs.io/settings/connected-apps")}`);
        }
        return;
      }
      const err = tok.json.error;
      if (err === "authorization_pending") continue;
      if (err === "slow_down") { pollMs += 2000; continue; }
      fail(`Authorization failed: ${err || `HTTP ${tok.status}`}`);
      process.exit(1);
    }
    fail("The code expired before you authorized. Run `molt auth login` again.");
    process.exit(1);
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
  if (!creds.apiKey && !creds.accessToken) {
    fail("Not signed in.");
    process.exit(1);
  }
  const api = new Api({ apiKey: creds.apiKey, accessToken: creds.accessToken, baseUrl: creds.apiUrl });
  // OAuth sessions are user-scoped (/auth/me); API keys are agent-scoped (/agents/me).
  const me = await api.request("GET", creds.accessToken ? "/auth/me" : "/agents/me");
  out(me, asJson);
}

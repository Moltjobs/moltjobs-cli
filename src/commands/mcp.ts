import { resolveAuth } from "../util/credentials.js";
import { c, fail, info, out, success, table, warn } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";
import { ALL_TARGETS, install, listInstalls, Target, uninstall } from "../util/mcp-install.js";

const TARGET_LABEL: Record<Target, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  codex: "OpenAI Codex CLI",
  windsurf: "Windsurf",
  vscode: "VS Code (native MCP)",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent (Nous Research)",
};

export async function mcpCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  switch (sub) {
    case undefined:
    case "list":
      return listCmd(asJson);
    case "install":
      return installCmd(args, asJson);
    case "uninstall":
    case "remove":
      return uninstallCmd(args, asJson);
    case "doctor":
      return doctorCmd(asJson);
    default:
      fail(`Unknown mcp subcommand: ${sub}`);
      process.exit(2);
  }
}

async function listCmd(asJson: boolean) {
  const r = await listInstalls();
  if (asJson) return out(r, true);
  table(
    r.map((row) => ({
      target: TARGET_LABEL[row.target],
      installed: row.installed ? c.green("✓") : c.dim("—"),
      configFile: row.file,
    })),
    ["target", "installed", "configFile"],
  );
}

async function installCmd(args: ParsedArgs, asJson: boolean) {
  const auth = await resolveAuth();
  const apiKey = flag(args.options, ["api-key"]) ?? auth.apiKey;
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? auth.agentId;
  const apiUrl = flag(args.options, ["api-url"]) ?? auth.apiUrl;
  const scope = (flag(args.options, ["scope"]) as "user" | "project" | undefined) ?? "user";

  if (!apiKey) {
    warn("No API key found. Run `molt auth login` first so the MCP server can authenticate.");
  }

  const explicit = args.positional.filter(Boolean);
  const targets = resolveTargets(explicit);

  const results: Array<{ target: string; file: string; action: string; notes?: string }> = [];
  for (const t of targets) {
    try {
      const r = await install(t, { apiKey, agentId, apiUrl, scope });
      results.push({ target: TARGET_LABEL[t], file: r.file, action: r.action });
      if (!asJson) {
        const tag =
          r.action === "created" ? c.green("created") : r.action === "updated" ? c.cyan("updated") : c.dim("unchanged");
        success(`${TARGET_LABEL[t]}: ${tag}  ${c.dim(r.file)}`);
      }
    } catch (err) {
      results.push({ target: TARGET_LABEL[t], file: "", action: "error", notes: (err as Error).message });
      if (!asJson) fail(`${TARGET_LABEL[t]}: ${(err as Error).message}`);
    }
  }
  if (asJson) return out({ results }, true);
  info(`Restart your AI tool to load the MoltJobs MCP. Then try: ${c.bold('"list open jobs in the LEAD_GEN vertical"')}`);
}

async function uninstallCmd(args: ParsedArgs, asJson: boolean) {
  const explicit = args.positional.filter(Boolean);
  const targets = resolveTargets(explicit);
  const results: Array<{ target: string; file: string; action: string }> = [];
  for (const t of targets) {
    const r = await uninstall(t, {});
    results.push({ target: TARGET_LABEL[t], file: r.file, action: r.action });
    if (!asJson) {
      const tag = r.action === "updated" ? c.green("removed") : c.dim("not present");
      info(`${TARGET_LABEL[t]}: ${tag}`);
    }
  }
  if (asJson) out({ results }, true);
}

async function doctorCmd(asJson: boolean) {
  const r = await listInstalls();
  const auth = await resolveAuth();
  const summary = {
    auth: {
      signedIn: Boolean(auth.apiKey),
      apiUrl: auth.apiUrl ?? "https://api.moltjobs.io/v1",
      agentId: auth.agentId ?? null,
    },
    integrations: r.map((row) => ({
      target: TARGET_LABEL[row.target],
      installed: row.installed,
      configFile: row.file,
    })),
  };
  out(summary, asJson);
}

function resolveTargets(positional: string[]): Target[] {
  if (positional.length === 0) {
    fail(`Specify a target. Available: ${ALL_TARGETS.join(", ")}, or "all".`);
    process.exit(2);
  }
  if (positional.includes("all")) return ALL_TARGETS.slice();
  const out: Target[] = [];
  for (const p of positional) {
    if ((ALL_TARGETS as string[]).includes(p)) out.push(p as Target);
    else {
      fail(`Unknown target: ${p}. Known: ${ALL_TARGETS.join(", ")}`);
      process.exit(2);
    }
  }
  return out;
}

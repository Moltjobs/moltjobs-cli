/**
 * Quick-install integration for MCP-compatible AI tools.
 *
 * Writes the @moltjobs/mcp server config into each tool's standard location.
 * If the file doesn't exist yet, we create it. If it does, we merge non-destructively.
 *
 * Supported targets: claude (Claude Code), claude-desktop, cursor, codex, windsurf, vscode.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as YAML from "yaml";

export type Target =
  | "claude"
  | "claude-desktop"
  | "cursor"
  | "codex"
  | "windsurf"
  | "vscode"
  | "openclaw"
  | "hermes";

export const ALL_TARGETS: Target[] = [
  "claude",
  "claude-desktop",
  "cursor",
  "codex",
  "windsurf",
  "vscode",
  "openclaw",
  "hermes",
];

export interface InstallContext {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  command?: string; // override (default: npx)
  args?: string[]; // override
  scope?: "user" | "project"; // claude/cursor: user-level or project-level
  projectDir?: string; // used for project scope
}

interface InstallResult {
  target: Target;
  file: string;
  action: "created" | "updated" | "unchanged";
  notes?: string;
}

export async function install(target: Target, ctx: InstallContext): Promise<InstallResult> {
  switch (target) {
    case "claude":
      return installClaudeCode(ctx);
    case "claude-desktop":
      return installClaudeDesktop(ctx);
    case "cursor":
      return installCursor(ctx);
    case "codex":
      return installCodex(ctx);
    case "windsurf":
      return installWindsurf(ctx);
    case "vscode":
      return installVscode(ctx);
    case "openclaw":
      return installOpenClaw(ctx);
    case "hermes":
      return installHermes(ctx);
  }
}

export async function uninstall(target: Target, ctx: InstallContext): Promise<InstallResult> {
  const file = targetConfigPath(target, ctx);
  return removeServer(target, file);
}

export async function listInstalls(): Promise<Array<{ target: Target; installed: boolean; file: string }>> {
  const results: Array<{ target: Target; installed: boolean; file: string }> = [];
  for (const t of ALL_TARGETS) {
    const file = targetConfigPath(t, {});
    const installed = await containsMoltjobsServer(t, file);
    results.push({ target: t, file, installed });
  }
  return results;
}

// ---- target-specific writers ------------------------------------------------

function defaultServerEntry(ctx: InstallContext) {
  const command = ctx.command ?? "npx";
  const args = ctx.args ?? ["-y", "@moltjobs/mcp"];
  const env: Record<string, string> = {};
  if (ctx.apiKey) env.MOLTJOBS_API_KEY = ctx.apiKey;
  if (ctx.agentId) env.MOLTJOBS_AGENT_ID = ctx.agentId;
  if (ctx.apiUrl) env.MOLTJOBS_API_URL = ctx.apiUrl;
  return { command, args, env };
}

async function installClaudeCode(ctx: InstallContext): Promise<InstallResult> {
  // ~/.claude.json (user-scope) or .mcp.json in project root
  const file =
    ctx.scope === "project"
      ? path.join(ctx.projectDir ?? process.cwd(), ".mcp.json")
      : path.join(os.homedir(), ".claude.json");
  return upsertJson(file, "claude", (json) => {
    json.mcpServers ??= {};
    json.mcpServers.moltjobs = defaultServerEntry(ctx);
    return json;
  });
}

async function installClaudeDesktop(ctx: InstallContext): Promise<InstallResult> {
  const file = claudeDesktopConfig();
  return upsertJson(file, "claude-desktop", (json) => {
    json.mcpServers ??= {};
    json.mcpServers.moltjobs = defaultServerEntry(ctx);
    return json;
  });
}

async function installCursor(ctx: InstallContext): Promise<InstallResult> {
  const file =
    ctx.scope === "project"
      ? path.join(ctx.projectDir ?? process.cwd(), ".cursor", "mcp.json")
      : path.join(os.homedir(), ".cursor", "mcp.json");
  return upsertJson(file, "cursor", (json) => {
    json.mcpServers ??= {};
    json.mcpServers.moltjobs = defaultServerEntry(ctx);
    return json;
  });
}

async function installCodex(ctx: InstallContext): Promise<InstallResult> {
  const file = path.join(os.homedir(), ".codex", "config.toml");
  const entry = defaultServerEntry(ctx);
  const block = renderCodexBlock("moltjobs", entry);
  return upsertToml(file, "moltjobs", block);
}

async function installWindsurf(ctx: InstallContext): Promise<InstallResult> {
  const file = path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
  return upsertJson(file, "windsurf", (json) => {
    json.mcpServers ??= {};
    json.mcpServers.moltjobs = defaultServerEntry(ctx);
    return json;
  });
}

async function installVscode(ctx: InstallContext): Promise<InstallResult> {
  const file =
    ctx.scope === "project"
      ? path.join(ctx.projectDir ?? process.cwd(), ".vscode", "mcp.json")
      : vscodeUserMcp();
  return upsertJson(file, "vscode", (json) => {
    json.servers ??= {};
    const e = defaultServerEntry(ctx);
    json.servers.moltjobs = {
      type: "stdio",
      command: e.command,
      args: e.args,
      env: e.env,
    };
    return json;
  });
}

async function installOpenClaw(ctx: InstallContext): Promise<InstallResult> {
  // OpenClaw stores MCP servers nested under `mcp.servers.<name>` in
  // ~/.openclaw/openclaw.json. Same stdio shape as Claude (command/args/env).
  const file = path.join(os.homedir(), ".openclaw", "openclaw.json");
  return upsertJson(file, "openclaw", (json) => {
    json.mcp ??= {};
    json.mcp.servers ??= {};
    json.mcp.servers.moltjobs = defaultServerEntry(ctx);
    return json;
  });
}

async function installHermes(ctx: InstallContext): Promise<InstallResult> {
  // Hermes Agent (Nous Research) uses YAML at ~/.hermes/config.yaml with
  // MCP servers under the top-level `mcp_servers` key.
  const file = path.join(os.homedir(), ".hermes", "config.yaml");
  return upsertYaml(file, "hermes", (doc) => {
    let servers = doc.get("mcp_servers");
    if (!(servers instanceof YAML.YAMLMap)) {
      const newServers = new YAML.YAMLMap();
      newServers.flow = false;
      doc.set("mcp_servers", newServers);
      servers = newServers;
    } else {
      (servers as YAML.YAMLMap).flow = false;
    }
    const entry = defaultServerEntry(ctx);
    // Build a fresh entry node in block style.
    const entryObj: Record<string, unknown> = {
      command: entry.command,
      args: entry.args,
    };
    if (Object.keys(entry.env).length > 0) entryObj.env = entry.env;
    const entryNode = doc.createNode(entryObj, { flow: false }) as YAML.YAMLMap;
    entryNode.flow = false;
    // Force block style on nested seq/map too
    for (const pair of entryNode.items) {
      const v = (pair as YAML.Pair).value;
      if (v instanceof YAML.YAMLMap || v instanceof YAML.YAMLSeq) v.flow = false;
    }
    (servers as YAML.YAMLMap).set("moltjobs", entryNode);
    return doc;
  });
}

// ---- helpers ----------------------------------------------------------------

function targetConfigPath(t: Target, ctx: InstallContext): string {
  switch (t) {
    case "claude":
      return ctx.scope === "project"
        ? path.join(ctx.projectDir ?? process.cwd(), ".mcp.json")
        : path.join(os.homedir(), ".claude.json");
    case "claude-desktop":
      return claudeDesktopConfig();
    case "cursor":
      return ctx.scope === "project"
        ? path.join(ctx.projectDir ?? process.cwd(), ".cursor", "mcp.json")
        : path.join(os.homedir(), ".cursor", "mcp.json");
    case "codex":
      return path.join(os.homedir(), ".codex", "config.toml");
    case "windsurf":
      return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
    case "vscode":
      return ctx.scope === "project"
        ? path.join(ctx.projectDir ?? process.cwd(), ".vscode", "mcp.json")
        : vscodeUserMcp();
    case "openclaw":
      return path.join(os.homedir(), ".openclaw", "openclaw.json");
    case "hermes":
      return path.join(os.homedir(), ".hermes", "config.yaml");
  }
}

function claudeDesktopConfig(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function vscodeUserMcp(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Code", "User", "mcp.json");
  }
  return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
}

async function upsertJson(
  file: string,
  target: Target,
  mutate: (json: Record<string, any>) => Record<string, any>,
): Promise<InstallResult> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let existed = true;
  let raw = "{}";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      existed = false;
      raw = "{}";
    } else {
      throw err;
    }
  }
  let json: Record<string, any>;
  try {
    json = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    throw new Error(
      `Could not parse existing config at ${file}. Fix it manually then re-run. (${(err as Error).message})`,
    );
  }
  const before = JSON.stringify(json);
  json = mutate(json);
  const after = JSON.stringify(json, null, 2) + "\n";
  if (existed && before === JSON.stringify(JSON.parse(after))) {
    return { target, file, action: "unchanged" };
  }
  await fs.writeFile(file, after, "utf8");
  return { target, file, action: existed ? "updated" : "created" };
}

async function upsertYaml(
  file: string,
  target: Target,
  mutate: (doc: YAML.Document.Parsed) => YAML.Document.Parsed,
): Promise<InstallResult> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let existed = true;
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      existed = false;
      raw = "";
    } else {
      throw err;
    }
  }
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(raw || "{}");
  } catch (err) {
    throw new Error(
      `Could not parse existing YAML at ${file}. Fix it manually then re-run. (${(err as Error).message})`,
    );
  }
  // Coerce to a mapping at root if needed
  if (!(doc.contents instanceof YAML.YAMLMap)) {
    const empty = new YAML.YAMLMap();
    empty.flow = false;
    (doc as any).contents = empty;
  } else {
    (doc.contents as YAML.YAMLMap).flow = false;
  }
  const yamlOpts = { lineWidth: 0, defaultStringType: "PLAIN" as const };
  const before = doc.toString(yamlOpts);
  doc = mutate(doc);
  const after = doc.toString(yamlOpts);
  if (existed && before === after) return { target, file, action: "unchanged" };
  await fs.writeFile(file, after.endsWith("\n") ? after : after + "\n", "utf8");
  return { target, file, action: existed ? "updated" : "created" };
}

async function upsertToml(file: string, key: string, block: string): Promise<InstallResult> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let existed = true;
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      existed = false;
      raw = "";
    } else {
      throw err;
    }
  }
  const header = `[mcp_servers.${key}]`;
  let next: string;
  if (raw.includes(header)) {
    // Replace existing block
    const lines = raw.split("\n");
    const startIdx = lines.findIndex((l) => l.trim() === header);
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        endIdx = i;
        break;
      }
    }
    const before = lines.slice(0, startIdx).join("\n").replace(/\n*$/, "");
    const after = lines.slice(endIdx).join("\n").replace(/^\n*/, "");
    next = [before, block, after].filter(Boolean).join("\n\n").trimEnd() + "\n";
  } else {
    next = (raw.trimEnd() + "\n\n" + block).trimStart() + "\n";
  }
  if (existed && raw === next) return { target: "codex", file, action: "unchanged" };
  await fs.writeFile(file, next, "utf8");
  return { target: "codex", file, action: existed ? "updated" : "created" };
}

function renderCodexBlock(name: string, entry: { command: string; args: string[]; env: Record<string, string> }): string {
  const lines = [`[mcp_servers.${name}]`];
  lines.push(`command = ${JSON.stringify(entry.command)}`);
  const args = entry.args.map((a) => JSON.stringify(a)).join(", ");
  lines.push(`args = [${args}]`);
  const envKeys = Object.keys(entry.env);
  if (envKeys.length) {
    const envPairs = envKeys.map((k) => `${k} = ${JSON.stringify(entry.env[k])}`).join(", ");
    lines.push(`env = { ${envPairs} }`);
  }
  return lines.join("\n");
}

async function containsMoltjobsServer(t: Target, file: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(file, "utf8");
    if (t === "codex") return raw.includes("[mcp_servers.moltjobs]");
    if (t === "vscode") {
      const j = JSON.parse(raw || "{}");
      return Boolean(j.servers?.moltjobs);
    }
    if (t === "openclaw") {
      const j = JSON.parse(raw || "{}");
      return Boolean(j.mcp?.servers?.moltjobs);
    }
    if (t === "hermes") {
      const doc = YAML.parse(raw || "{}");
      return Boolean(doc?.mcp_servers?.moltjobs);
    }
    const j = JSON.parse(raw || "{}");
    return Boolean(j.mcpServers?.moltjobs);
  } catch {
    return false;
  }
}

async function removeServer(t: Target, file: string): Promise<InstallResult> {
  try {
    const raw = await fs.readFile(file, "utf8");
    if (t === "codex") {
      const lines = raw.split("\n");
      const startIdx = lines.findIndex((l) => l.trim() === "[mcp_servers.moltjobs]");
      if (startIdx < 0) return { target: t, file, action: "unchanged" };
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          endIdx = i;
          break;
        }
      }
      const before = lines.slice(0, startIdx).join("\n").replace(/\n*$/, "");
      const after = lines.slice(endIdx).join("\n").replace(/^\n*/, "");
      const next = [before, after].filter(Boolean).join("\n\n").trimEnd() + "\n";
      await fs.writeFile(file, next, "utf8");
      return { target: t, file, action: "updated" };
    }
    if (t === "hermes") {
      const doc = YAML.parseDocument(raw || "{}");
      const servers = doc.get("mcp_servers");
      if (!(servers instanceof YAML.YAMLMap) || !servers.has("moltjobs")) {
        return { target: t, file, action: "unchanged" };
      }
      servers.delete("moltjobs");
      await fs.writeFile(file, doc.toString(), "utf8");
      return { target: t, file, action: "updated" };
    }
    const j: Record<string, any> = JSON.parse(raw || "{}");
    if (t === "vscode") {
      if (!j.servers?.moltjobs) return { target: t, file, action: "unchanged" };
      delete j.servers.moltjobs;
    } else if (t === "openclaw") {
      if (!j.mcp?.servers?.moltjobs) return { target: t, file, action: "unchanged" };
      delete j.mcp.servers.moltjobs;
    } else {
      if (!j.mcpServers?.moltjobs) return { target: t, file, action: "unchanged" };
      delete j.mcpServers.moltjobs;
    }
    await fs.writeFile(file, JSON.stringify(j, null, 2) + "\n", "utf8");
    return { target: t, file, action: "updated" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { target: t, file, action: "unchanged" };
    }
    throw err;
  }
}

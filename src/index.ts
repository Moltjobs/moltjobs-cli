#!/usr/bin/env node
/**
 * `molt` — the MoltJobs CLI.
 *
 * Usage: `molt <command> [sub] [args] [flags]`
 *
 * Distributed as @moltjobs/cli; works identically on Linux, macOS, and Windows
 * (any platform with Node ≥18). Stores credentials in
 *   ~/.moltjobs/credentials.json   (POSIX, mode 0600)
 *   %APPDATA%\MoltJobs\credentials.json   (Windows)
 *
 * Companion to @moltjobs/mcp: `molt mcp install claude` (or cursor / codex /
 * windsurf / vscode) wires the MCP server into your AI tool of choice.
 */

import { parseArgs } from "./util/args.js";
import { authCommand } from "./commands/auth.js";
import { jobsCommand } from "./commands/jobs.js";
import { bidsCommand } from "./commands/bids.js";
import { walletCommand } from "./commands/wallet.js";
import { agentCommand } from "./commands/agent.js";
import { mcpCommand } from "./commands/mcp.js";
import { templatesCommand } from "./commands/templates.js";
import { activityCommand, statsCommand } from "./commands/stats.js";
import { noticesCommand, updateCommand } from "./commands/update.js";
import { maybeShowUpdateBanner } from "./util/update-check.js";
import { resolveAuth } from "./util/credentials.js";
import { c, fail } from "./util/output.js";

const VERSION = "0.3.2";

const HELP = `${c.bold("molt")} — MoltJobs CLI (v${VERSION})

${c.bold("USAGE")}
  molt <command> [subcommand] [args] [--flag value]

${c.bold("COMMON")}
  ${c.cyan("molt auth login")}                 Sign in with an API key
  ${c.cyan("molt jobs list")}                  Browse open jobs
  ${c.cyan("molt jobs show <id>")}             Inspect a job
  ${c.cyan("molt bid <jobId> --amount 50")}    Place a bid
  ${c.cyan("molt wallet balance")}             Check USDC balance
  ${c.cyan("molt mcp install claude")}         Add the MoltJobs MCP to Claude Code

${c.bold("COMMANDS")}
  ${c.bold("auth")}        login | logout | status | whoami | where
  ${c.bold("jobs")}        list | show <id> | search <q> | mine | start <id>
              submit <id> --output @file.json | approve <id>
              reject <id> --reason <text> | cancel <id> | events <id>
  ${c.bold("bid")}         <jobId> --amount <usdc> [--cover-letter <text>]
  ${c.bold("bids")}        list <jobId> | withdraw <jobId> <bidId>
              accept <jobId> <bidId> | allowance | buy
  ${c.bold("wallet")}      balance | provision | withdraw --to <addr> --amount <usdc>
              transactions
  ${c.bold("agent")}       list | show <id> | me | register <handle> | heartbeat
              api-keys [list|create|revoke]
  ${c.bold("templates")}   list | show <id>
  ${c.bold("mcp")}         install [target…] | uninstall [target…] | list | doctor
              targets: claude | claude-desktop | cursor | codex | windsurf | vscode
                       | openclaw | hermes | all
  ${c.bold("stats")}       Platform-wide metrics
  ${c.bold("activity")}    Recent platform activity
  ${c.bold("update")}      Check for + install the latest @moltjobs/cli
  ${c.bold("notices")}     Show active platform announcements

${c.bold("GLOBAL FLAGS")}
  --json                Emit JSON to stdout (machine-readable)
  --quiet               Suppress the update-available banner this run
  --api-key <key>       Override stored credential
  --api-url <url>       Override API base URL
  --agent-id <id>       Override default agent
  --help, -h            Show this help
  --version, -v         Print version

${c.bold("ENV")}
  MOLTJOBS_API_KEY      Defaults to your stored credential
  MOLTJOBS_API_URL      ${c.dim("default https://api.moltjobs.io/v1")}
  MOLTJOBS_AGENT_ID     Default agent for wallet/bid/heartbeat commands
  NO_COLOR=1            Disable color output
  MOLT_NO_UPDATE_CHECK=1   Disable update polling + banners

${c.bold("DOCS")}
  ${c.dim("https://moltjobs.io/docs/cli")}
  ${c.dim("https://moltjobs.io/docs/mcp")}
  ${c.dim("https://moltjobs.io/docs/api")}
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`molt ${VERSION}\n`);
    return;
  }

  // Parse the WHOLE argv (after the command) — don't lift `sub` out by raw
  // position, because top-level flags like `notices --ack-all` would otherwise
  // be misread as the subcommand. The first leftover positional is the sub.
  const command = argv[0];
  const parsed = parseArgs(argv.slice(1));
  const sub = parsed.positional[0];
  parsed.positional = parsed.positional.slice(1);

  try {
    switch (command) {
      case "auth":
        await authCommand(sub, parsed);
        break;
      case "jobs":
      case "job":
        await jobsCommand(sub, parsed);
        break;
      case "bid":
        // shortcut: `molt bid <jobId> --amount <n>`
        await bidsCommand("place", { positional: sub ? [sub, ...parsed.positional] : parsed.positional, options: parsed.options });
        break;
      case "bids":
        await bidsCommand(sub, parsed);
        break;
      case "wallet":
        await walletCommand(sub, parsed);
        break;
      case "agent":
      case "agents":
        await agentCommand(sub, parsed);
        break;
      case "mcp":
        await mcpCommand(sub, parsed);
        break;
      case "templates":
      case "template":
        await templatesCommand(sub, parsed);
        break;
      case "stats":
        await statsCommand(parsed);
        break;
      case "activity":
        await activityCommand(parsed);
        break;
      case "update":
      case "upgrade":
        await updateCommand(parsed, VERSION);
        break;
      case "notices":
      case "news":
        await noticesCommand(parsed, VERSION);
        break;
      default:
        fail(`Unknown command: ${command}. Run "molt --help" for usage.`);
        process.exit(2);
    }
  } catch (err) {
    fail((err as Error).message);
    if (process.env.MOLT_DEBUG) {
      process.stderr.write(((err as Error).stack ?? "") + "\n");
    }
    process.exit(1);
  }

  // After the command runs, show any pending update / announcement banners.
  // Skip for `update` and `notices` themselves (they already print).
  if (command !== "update" && command !== "upgrade" && command !== "notices" && command !== "news") {
    try {
      const auth = await resolveAuth();
      await maybeShowUpdateBanner({
        baseUrl: auth.apiUrl ?? "https://api.moltjobs.io/v1",
        currentVersion: VERSION,
        asJson: parsed.options.json === true,
        quiet: parsed.options.quiet === true,
      });
    } catch {
      // banner is best-effort
    }
  }
}

main();

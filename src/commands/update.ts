import { spawnSync } from "node:child_process";
import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { c, fail, info, out, success, warn } from "../util/output.js";
import { ParsedArgs, boolFlag } from "../util/args.js";
import { refreshNow, getCachedPayload, markShown, renderAnnouncement } from "../util/update-check.js";

const CURRENT_VERSION = process.env.MOLT_VERSION ?? "0.0.0";

function semverCmp(a: string, b: string): number {
  const ax = a.replace(/[^0-9.].*$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const bx = b.replace(/[^0-9.].*$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((ax[i] ?? 0) !== (bx[i] ?? 0)) return (ax[i] ?? 0) - (bx[i] ?? 0);
  }
  return 0;
}

export async function updateCommand(args: ParsedArgs, version: string) {
  const asJson = args.options.json === true;
  const check = boolFlag(args.options, ["check"]);
  const yes = boolFlag(args.options, ["yes", "y"]);
  const auth = await resolveAuth();
  const baseUrl = auth.apiUrl ?? "https://api.moltjobs.io/v1";

  if (!asJson) info(`Checking ${c.bold("api.moltjobs.io")} for the latest CLI release…`);
  const payload = await refreshNow({ baseUrl, currentVersion: version, channel: "cli" });
  if (!payload) {
    fail("Couldn't reach the releases endpoint. Try again later.");
    process.exit(1);
  }
  const latest = payload.latest?.cli;
  if (!latest) {
    fail("Releases response didn't include a `cli` entry.");
    process.exit(1);
  }

  if (asJson) {
    out({ current: version, latest, announcements: payload.announcements }, true);
    return;
  }

  const cmp = semverCmp(latest.version, version);
  if (cmp <= 0) {
    success(`You're on the latest @moltjobs/cli (${c.bold(version)}).`);
    return;
  }

  info(`Update available: ${c.dim(version)} → ${c.green(c.bold(latest.version))}`);
  if (latest.summary) info(latest.summary);
  info(`Notes: ${c.cyan(latest.notesUrl)}`);

  if (check) return;

  if (!yes) {
    warn(`This will run: ${c.bold("npm i -g @moltjobs/cli@latest")}`);
    if (process.stdin.isTTY) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
      rl.close();
      if (ans !== "y" && ans !== "yes") {
        fail("Aborted.");
        process.exit(1);
      }
    } else {
      fail("Not a TTY. Re-run with --yes to upgrade non-interactively.");
      process.exit(2);
    }
  }

  info("Running npm i -g @moltjobs/cli@latest…");
  const result = spawnSync("npm", ["i", "-g", "@moltjobs/cli@latest"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail("npm install exited non-zero. You may need sudo: `sudo npm i -g @moltjobs/cli@latest`");
    process.exit(result.status ?? 1);
  }
  success("Upgrade complete. Run `molt --version` to confirm.");
}

export async function noticesCommand(args: ParsedArgs, version: string) {
  const asJson = args.options.json === true;
  const all = boolFlag(args.options, ["all"]);
  const ackAll = boolFlag(args.options, ["ack-all", "acknowledge-all"]);
  const auth = await resolveAuth();
  const baseUrl = auth.apiUrl ?? "https://api.moltjobs.io/v1";

  let payload = await getCachedPayload();
  if (!payload) {
    payload = (await refreshNow({ baseUrl, currentVersion: version, channel: "cli" })) ?? undefined;
  }
  if (!payload) {
    if (asJson) {
      out({ announcements: [] }, true);
    } else {
      fail("Couldn't fetch announcements.");
    }
    return;
  }

  if (asJson) {
    out({ announcements: payload.announcements }, true);
    return;
  }

  if ((payload.announcements ?? []).length === 0) {
    info("No active announcements.");
    return;
  }

  for (const a of payload.announcements) {
    process.stdout.write(renderAnnouncement(a) + "\n\n");
    if (ackAll || all) await markShown(a.id);
  }
  if (ackAll) {
    success("All announcements acknowledged — they won't show again.");
  }
}

export const _CURRENT_VERSION = CURRENT_VERSION;

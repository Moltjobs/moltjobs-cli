/**
 * Background update check + announcement banner.
 *
 * Behavior:
 *   - Runs at most once every 24h (cached in ~/.moltjobs/update-check.json).
 *   - Fire-and-forget: never blocks a command. If the network is slow or down,
 *     the user sees no warning, no banner, no error.
 *   - Prints to stderr only when stdout is a TTY AND --json wasn't requested.
 *   - Each announcement ID is shown exactly once per machine.
 *
 * Suppression:
 *   --quiet                    no banner this run (but still polls + caches)
 *   --json                     no banner ever
 *   MOLT_NO_UPDATE_CHECK=1     no network, no banner
 *   not a TTY                  no banner (CI / pipes)
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { c } from "./output.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 3000;

type Level = "info" | "warn" | "critical";

interface Announcement {
  id: string;
  level: Level;
  title: string;
  body: string;
  url?: string;
  expiresAt?: string;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  install: string;
  notesUrl: string;
  summary?: string;
}

interface ReleasesPayload {
  schemaVersion: string;
  latest: Record<string, ReleaseInfo>;
  announcements: Announcement[];
  serverTime: string;
}

interface CacheFile {
  lastCheckedAt: number;
  payload?: ReleasesPayload;
  shownAnnouncementIds: string[];
  warnedAboutUpgrade?: string; // version we last told the user about
}

function cacheDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "MoltJobs");
  }
  return path.join(os.homedir(), ".moltjobs");
}
function cachePath(): string {
  return path.join(cacheDir(), "update-check.json");
}

async function readCache(): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(cachePath(), "utf8");
    return JSON.parse(raw) as CacheFile;
  } catch {
    return { lastCheckedAt: 0, shownAnnouncementIds: [] };
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(cachePath(), JSON.stringify(cache, null, 2) + "\n", "utf8");
}

function semverCmp(a: string, b: string): number {
  const ax = a.replace(/[^0-9.].*$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const bx = b.replace(/[^0-9.].*$/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((ax[i] ?? 0) !== (bx[i] ?? 0)) return (ax[i] ?? 0) - (bx[i] ?? 0);
  }
  return 0;
}

async function fetchReleases(baseUrl: string, currentVersion: string, channel: string): Promise<ReleasesPayload | null> {
  try {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/releases`);
    url.searchParams.set("channel", channel);
    url.searchParams.set("version", currentVersion);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        "User-Agent": `moltjobs-cli/${currentVersion}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as { data?: ReleasesPayload } | null;
    return payload?.data ?? null;
  } catch {
    return null;
  }
}

/** Get the cached payload — useful for `molt update` and `molt notices`. */
export async function getCachedPayload(): Promise<ReleasesPayload | undefined> {
  const cache = await readCache();
  return cache.payload;
}

/** Force a fresh fetch and update the cache. Returns the payload or null. */
export async function refreshNow(opts: {
  baseUrl: string;
  currentVersion: string;
  channel?: string;
}): Promise<ReleasesPayload | null> {
  const payload = await fetchReleases(opts.baseUrl, opts.currentVersion, opts.channel ?? "cli");
  if (!payload) return null;
  const cache = await readCache();
  cache.payload = payload;
  cache.lastCheckedAt = Date.now();
  await writeCache(cache);
  return payload;
}

/** Mark an announcement ID as shown so it doesn't appear again. */
export async function markShown(id: string): Promise<void> {
  const cache = await readCache();
  if (!cache.shownAnnouncementIds.includes(id)) {
    cache.shownAnnouncementIds.push(id);
    // Keep the list bounded — drop the oldest if we somehow accumulate >100.
    if (cache.shownAnnouncementIds.length > 100) {
      cache.shownAnnouncementIds = cache.shownAnnouncementIds.slice(-100);
    }
    await writeCache(cache);
  }
}

/** Mark an upgrade banner as already shown for a given version. */
async function markUpgradeWarned(version: string): Promise<void> {
  const cache = await readCache();
  cache.warnedAboutUpgrade = version;
  await writeCache(cache);
}

/** Render a single announcement to a banner string. */
export function renderAnnouncement(a: Announcement): string {
  const tag =
    a.level === "critical"
      ? c.red("[CRITICAL]")
      : a.level === "warn"
        ? c.yellow("[NOTICE]")
        : c.cyan("[MoltJobs]");
  const lines = [
    `${tag} ${c.bold(a.title)}`,
    `  ${a.body}`,
    a.url ? `  ${c.dim(a.url)}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Render the upgrade-available banner. */
function renderUpgradeBanner(current: string, latest: ReleaseInfo): string {
  return [
    `${c.cyan("›")} ${c.bold("MoltJobs CLI update available")}: ${c.dim(current)} → ${c.green(latest.version)}`,
    `  ${latest.summary ?? "Run `molt update` or `npm i -g @moltjobs/cli` to upgrade."}`,
    `  ${c.dim(latest.notesUrl)}`,
  ].join("\n");
}

/**
 * Called from main() AFTER the user's command runs. Non-blocking.
 *
 * Strategy:
 *   1. Read cache.
 *   2. If cache is stale (>24h), kick off a fresh fetch in the background and
 *      let it complete; if it takes >2.5s we just give up.
 *   3. Print pending announcements + upgrade banner if appropriate.
 */
export async function maybeShowUpdateBanner(opts: {
  baseUrl: string;
  currentVersion: string;
  asJson: boolean;
  quiet: boolean;
}): Promise<void> {
  // Hard suppressions
  if (process.env.MOLT_NO_UPDATE_CHECK === "1") return;
  if (opts.asJson) return;
  if (!process.stderr.isTTY) return;

  try {
    const cache = await readCache();
    let payload = cache.payload;

    if (!payload || Date.now() - cache.lastCheckedAt > CHECK_INTERVAL_MS) {
      payload = (await fetchReleases(opts.baseUrl, opts.currentVersion, "cli")) ?? payload;
      if (payload) {
        cache.payload = payload;
        cache.lastCheckedAt = Date.now();
        await writeCache(cache);
      }
    }

    if (!payload) return;
    if (opts.quiet) return;

    // Upgrade banner — only show once per new-target version.
    const latestCli = payload.latest?.cli;
    if (latestCli && semverCmp(latestCli.version, opts.currentVersion) > 0) {
      const c2 = await readCache();
      if (c2.warnedAboutUpgrade !== latestCli.version) {
        process.stderr.write("\n" + renderUpgradeBanner(opts.currentVersion, latestCli) + "\n");
        await markUpgradeWarned(latestCli.version);
      }
    }

    // Announcements — show each once.
    const shown = new Set((await readCache()).shownAnnouncementIds);
    const pending = (payload.announcements ?? []).filter((a) => !shown.has(a.id));
    for (const a of pending) {
      process.stderr.write("\n" + renderAnnouncement(a) + "\n");
      await markShown(a.id);
    }
  } catch {
    // Update check failures are silent by design.
  }
}

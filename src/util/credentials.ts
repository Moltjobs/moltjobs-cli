import { promises as fs, constants as fsc } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface Credentials {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  email?: string;
  updatedAt?: string;
  // OAuth (device-flow) session — preferred over a static API key when present.
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  authType?: "apikey" | "oauth";
}

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function configDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "MoltJobs");
  }
  return path.join(os.homedir(), ".moltjobs");
}

function credentialsPath(): string {
  return path.join(configDir(), "credentials.json");
}

export async function ensureConfigDir(): Promise<string> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true });
  // On POSIX, lock down to 0700.
  if (process.platform !== "win32") {
    try {
      await fs.chmod(dir, 0o700);
    } catch {
      /* ignore */
    }
  }
  return dir;
}

export async function readCredentials(): Promise<Credentials> {
  try {
    const raw = await fs.readFile(credentialsPath(), "utf8");
    return JSON.parse(raw) as Credentials;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  await ensureConfigDir();
  const merged: Credentials = {
    ...(await readCredentials()),
    ...creds,
    updatedAt: new Date().toISOString(),
  };
  const file = credentialsPath();
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
  if (process.platform !== "win32") {
    try {
      await fs.chmod(file, 0o600);
    } catch {
      /* ignore */
    }
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(credentialsPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function getConfigPath(): string {
  return credentialsPath();
}

export async function resolveAuth(opts: { apiKey?: string; agentId?: string; apiUrl?: string } = {}): Promise<Credentials> {
  let stored = await readCredentials();
  const apiUrl = opts.apiUrl ?? process.env.MOLTJOBS_API_URL ?? stored.apiUrl;

  // Refresh the OAuth access token if it is missing/near expiry (within 60s).
  if (stored.accessToken && stored.refreshToken && stored.clientId) {
    const exp = jwtExp(stored.accessToken);
    if (exp === 0 || exp * 1000 - Date.now() < 60_000) {
      const refreshed = await refreshOAuthToken(stored, apiUrl);
      if (refreshed) stored = refreshed;
    }
  }

  return {
    apiKey: opts.apiKey ?? process.env.MOLTJOBS_API_KEY ?? stored.apiKey,
    agentId: opts.agentId ?? process.env.MOLTJOBS_AGENT_ID ?? stored.agentId,
    apiUrl,
    email: stored.email,
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    clientId: stored.clientId,
    authType: stored.authType,
  };
}

async function refreshOAuthToken(creds: Credentials, apiUrl?: string): Promise<Credentials | null> {
  const base = (apiUrl ?? "https://api.moltjobs.io/v1").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!j.access_token) return null;
    await writeCredentials({
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? creds.refreshToken,
    });
    return { ...creds, accessToken: j.access_token, refreshToken: j.refresh_token ?? creds.refreshToken };
  } catch {
    return null;
  }
}

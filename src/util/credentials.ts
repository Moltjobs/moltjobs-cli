import { promises as fs, constants as fsc } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface Credentials {
  apiKey?: string;
  agentId?: string;
  apiUrl?: string;
  email?: string;
  updatedAt?: string;
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

export async function resolveAuth(opts: { apiKey?: string; agentId?: string; apiUrl?: string } = {}): Promise<Required<Credentials> | Credentials> {
  const stored = await readCredentials();
  return {
    apiKey: opts.apiKey ?? process.env.MOLTJOBS_API_KEY ?? stored.apiKey,
    agentId: opts.agentId ?? process.env.MOLTJOBS_AGENT_ID ?? stored.agentId,
    apiUrl: opts.apiUrl ?? process.env.MOLTJOBS_API_URL ?? stored.apiUrl,
    email: stored.email,
  };
}

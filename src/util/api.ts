/**
 * Thin fetch-based MoltJobs API client used by the CLI.
 * Mirrors the MCP server's client but keeps zero runtime deps.
 */

export class ApiError extends Error {
  status: number;
  type: string;
  detail?: string;
  requestId?: string;
  body?: unknown;
  constructor(opts: { status: number; title: string; type?: string; detail?: string; requestId?: string; body?: unknown }) {
    super(`${opts.title}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "ApiError";
    this.status = opts.status;
    this.type = opts.type ?? "about:blank";
    this.detail = opts.detail;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}

export interface ApiOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE = "https://api.moltjobs.io/v1";

export class Api {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;

  constructor(opts: ApiOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.MOLTJOBS_API_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? process.env.MOLTJOBS_API_KEY;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      "User-Agent": "moltjobs-cli/0.1",
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers["X-Api-Key"] = this.apiKey;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
      const requestId = res.headers.get("x-request-id") ?? undefined;
      const contentType = res.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json") || contentType.includes("+json");
      const payload = isJson ? await res.json().catch(() => undefined) : await res.text().catch(() => undefined);

      if (!res.ok) {
        const p = (payload ?? {}) as Record<string, unknown>;
        throw new ApiError({
          status: res.status,
          title: (p.title as string) || res.statusText || "Request failed",
          type: p.type as string | undefined,
          detail: (p.detail as string) || (typeof payload === "string" ? payload : undefined),
          requestId: (p.requestId as string) || requestId,
          body: payload,
        });
      }
      if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
        return (payload as { data: T }).data;
      }
      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

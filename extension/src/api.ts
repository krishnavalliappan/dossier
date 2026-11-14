// The extension's side of Dossier's /api/ext: where Dossier is, the token,
// and one call with an error that says what to do about it.

import type { ExtApplication, SaveResult } from "../../src/lib/ext/applications";
import type { JobUrl } from "../../src/lib/ext/url";
import { chrome } from "./chrome";

export type Config = { server: string; token: string };
export type Lookup = { page: JobUrl; matches: ExtApplication[] };
export type Ping = { ok: true; version: string; scopes: string[] };
export type { ExtApplication, SaveResult };

export const TOKEN = /^dsr_[A-Za-z0-9_-]{43}$/;

/** What was typed as Dossier's address, as an origin: http(s), no user or password, any path dropped. */
export function serverOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The host permission for an origin (match patterns can't name a port). */
export const originPattern = (origin: string) => {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
};

export async function getConfig(): Promise<Config | null> {
  const { server, token } = await chrome.storage.local.get(["server", "token"]);
  return typeof server === "string" && typeof token === "string" && server && token ? { server, token } : null;
}

/**
 * - offline / timeout: Dossier didn't answer;
 * - signed-out / token-invalid / scope: the token doesn't work (or can't do this): reconnect in Options;
 * - the rest are Dossier's own codes (bad-request, not-found, not-ready, conflict, unexpected).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }

  /** Whether fixing it means reconnecting in Options. */
  get reconnect() {
    return this.code === "signed-out" || this.code === "token-invalid" || this.code === "scope" || this.code === "no-config";
  }
}

const TIMEOUT_MS = 20_000;

/**
 * One call to Dossier. Only the token authenticates it (never cookies), and
 * redirects are refused, so the token only ever goes to the address in Options.
 */
export async function call(config: Config | null, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  if (!config) throw new ApiError("no-config", "Connect the extension to your Dossier first.");
  const { timeoutMs = TIMEOUT_MS, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${config.server}/api/ext${path}`, {
      ...rest,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${config.token}`, ...(rest.body ? { "content-type": "application/json" } : {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new ApiError("timeout", `Dossier didn't answer in ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new ApiError("offline", `Can't reach Dossier at ${config.server}. Check that it's running, and the address in Options.`);
  }
  if (response.ok) return response;
  let error: { code?: unknown; message?: unknown } = {};
  try {
    error = ((await response.json()) as { error?: typeof error }).error ?? {};
  } catch {
    // Not Dossier's JSON: a proxy's error page, say.
  }
  const code = typeof error.code === "string" ? error.code : `http-${response.status}`;
  const message = typeof error.message === "string" ? error.message : `Dossier answered ${response.status}.`;
  throw new ApiError(code, message, response.status);
}

export const json = async <T>(config: Config | null, path: string, init?: RequestInit & { timeoutMs?: number }) => (await (await call(config, path, init)).json()) as T;

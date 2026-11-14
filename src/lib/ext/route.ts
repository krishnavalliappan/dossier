import "server-only";

// Fork-only: route handlers for /api/ext/*, the browser extension's API.
// They take a personal access token (Authorization: Bearer dsr_…) and
// nothing else: no session cookie, so a page can't ride on a signed-in
// browser, and the app's own routes (route() in src/lib/route.ts) never
// take a token. No CORS headers either: the extension calls from its
// service worker, which its host permission lets through; pages can't read
// the answers.

import { unstable_rethrow } from "next/navigation";
import { type NextRequest, NextResponse } from "next/server";

import { logServerError } from "@/lib/log";

import { bearer, checkToken, type ExtScope } from "./tokens";

/** The token a request came with, checked. */
export type ExtToken = { id: string; scopes: ExtScope[] };

/** What went wrong, for the extension to show; `code` is stable, `message` written for the user. */
export type ExtErrorCode = "signed-out" | "token-invalid" | "scope" | "bad-request" | "not-found" | "not-ready" | "conflict" | "unexpected";

const STATUS: Record<ExtErrorCode, number> = {
  "signed-out": 401,
  "token-invalid": 401,
  scope: 403,
  "bad-request": 400,
  "not-found": 404,
  "not-ready": 409,
  conflict: 409,
  unexpected: 500,
};

/** Throw from a handler to answer with this error. */
export class ExtError extends Error {
  override name = "ExtError";
  constructor(
    readonly code: ExtErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function extError(code: ExtErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code], headers: { "cache-control": "private, no-store" } });
}

const REASONS = {
  missing: ["signed-out", "Connect the extension: paste a token from Dossier → Settings → Extension & ATS."],
  invalid: ["token-invalid", "This token no longer works (revoked, or the password changed). Make a new one in Settings → Extension & ATS."],
  scope: ["scope", "This token isn't allowed to do that. Make one with the right permissions in Settings → Extension & ATS."],
} as const;

/** A /api/ext/* handler that needs a token with every scope in `scopes`. */
export function extRoute<Context = unknown>(
  scopes: readonly ExtScope[],
  handler: (request: NextRequest, context: Context, token: ExtToken) => Promise<Response>,
): (request: NextRequest, context: Context) => Promise<Response> {
  return async (request, context) => {
    const check = await checkToken(bearer(request.headers), scopes);
    if (!check.ok) {
      const [code, message] = REASONS[check.reason];
      return extError(code, message);
    }
    let response: Response;
    try {
      response = await handler(request, context, { id: check.id, scopes: check.scopes });
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof ExtError) return extError(error.code, error.message);
      logServerError(`${request.method} ${request.nextUrl.pathname}`, error);
      return extError("unexpected", "Something went wrong in Dossier. Try again; if it keeps happening, check the server's log.");
    }
    if (!response.headers.has("cache-control")) {
      try {
        response.headers.set("cache-control", "private, no-store");
      } catch {
        // Immutable headers (a redirect): leave them.
      }
    }
    return response;
  };
}

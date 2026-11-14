import "server-only";

// Fork-only: personal access tokens for the browser extension. A token is
// "dsr_" and 32 random bytes; only its HMAC is stored, so a copy of the
// database can't be used to call the API. A token works until it's revoked,
// or until the password changes (as the connector's tokens do).

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { passwordFingerprint } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const EXT_SCOPES = ["applications:read", "applications:write", "resume:read"] as const;
export type ExtScope = (typeof EXT_SCOPES)[number];

export const TOKEN_PREFIX = "dsr_";
const TOKEN = /^dsr_[A-Za-z0-9_-]{43}$/;
/** lastUsedAt is written at most this often per token, not on every request. */
const LAST_USED_EVERY_MS = 60_000;

let hashKey: Buffer | undefined;
function key(): Buffer {
  hashKey ??= Buffer.from(hkdfSync("sha256", env.DOSSIER_SECRET, "", "dossier ext-token v1", 32));
  return hashKey;
}

export const hashToken = (token: string) => createHmac("sha256", key()).update(token, "utf8").digest("base64url");

export const isScope = (value: string): value is ExtScope => (EXT_SCOPES as readonly string[]).includes(value);
const scopesOf = (stored: string) => stored.split(" ").filter(isScope);

export type TokenView = { id: string; name: string; prefix: string; scopes: ExtScope[]; createdAt: Date; lastUsedAt: Date | null; valid: boolean };

/** Makes a token. The token itself is returned only here: show it once. */
export async function createToken(name: string, scopes: readonly ExtScope[]): Promise<{ token: string; view: TokenView }> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await prisma.extToken.create({
    data: { name: name.trim() || "Browser extension", hash: hashToken(token), prefix: token.slice(0, 10), scopes: [...new Set(scopes)].join(" "), pwd: passwordFingerprint() },
  });
  return { token, view: view(row, passwordFingerprint()) };
}

function view(row: { id: string; name: string; prefix: string; scopes: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; pwd: string }, pwd: string): TokenView {
  return { id: row.id, name: row.name, prefix: row.prefix, scopes: scopesOf(row.scopes), createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, valid: !row.revokedAt && row.pwd === pwd };
}

/** The tokens not revoked, newest first; one made before the password changed shows as no longer valid. */
export async function listTokens(): Promise<TokenView[]> {
  const rows = await prisma.extToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } });
  const pwd = passwordFingerprint();
  return rows.map((row) => view(row, pwd));
}

export async function revokeToken(id: string): Promise<boolean> {
  const { count } = await prisma.extToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  return count > 0;
}

export type TokenCheck = { ok: true; id: string; scopes: ExtScope[] } | { ok: false; reason: "missing" | "invalid" | "scope" };

/** Checks a bearer token for every scope in `needs`. */
export async function checkToken(raw: string | null | undefined, needs: readonly ExtScope[]): Promise<TokenCheck> {
  if (!raw) return { ok: false, reason: "missing" };
  if (!TOKEN.test(raw)) return { ok: false, reason: "invalid" };
  const hash = hashToken(raw);
  const row = await prisma.extToken.findUnique({ where: { hash } });
  // The lookup is by hash; compare again in constant time all the same.
  if (!row || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash))) return { ok: false, reason: "invalid" };
  if (row.revokedAt || row.pwd !== passwordFingerprint()) return { ok: false, reason: "invalid" };
  const scopes = scopesOf(row.scopes);
  if (!needs.every((scope) => scopes.includes(scope))) return { ok: false, reason: "scope" };
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    await prisma.extToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } });
  }
  return { ok: true, id: row.id, scopes };
}

/** The token in an `Authorization: Bearer …` header, if any. */
export function bearer(headers: Headers): string | null {
  const value = headers.get("authorization");
  const match = value && /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : null;
}

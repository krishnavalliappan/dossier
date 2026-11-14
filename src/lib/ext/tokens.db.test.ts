import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const auth = vi.hoisted(() => ({ fingerprint: "pwd-1", session: null as unknown }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({ passwordFingerprint: () => auth.fingerprint, getSession: async () => auth.session }));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "test-secret-test-secret-test-secret-00" } }));
const prisma = () => db.client!;

const { ExtError, extRoute } = await import("./route");
const { checkToken, createToken, hashToken, listTokens, revokeToken } = await import("./tokens");
const { route } = await import("@/lib/route");

beforeEach(async () => {
  await resetDatabase(prisma());
  auth.fingerprint = "pwd-1";
  auth.session = null;
});
afterAll(() => prisma().$disconnect());

describe("tokens", () => {
  it("stores only the token's HMAC, and checks a token for its scopes", async () => {
    const { token, view } = await createToken("Chrome", ["applications:read", "resume:read"]);
    expect(token).toMatch(/^dsr_[A-Za-z0-9_-]{43}$/);
    const row = await prisma().extToken.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.hash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token.slice(4));
    expect(row.prefix).toBe(token.slice(0, 10));

    expect(await checkToken(token, ["applications:read"])).toEqual({ ok: true, id: view.id, scopes: ["applications:read", "resume:read"] });
    expect(await checkToken(token, ["applications:write"])).toEqual({ ok: false, reason: "scope" });
    expect((await prisma().extToken.findUniqueOrThrow({ where: { id: view.id } })).lastUsedAt).not.toBeNull();
  });

  it("refuses missing, malformed, unknown and revoked tokens", async () => {
    const { token, view } = await createToken("Chrome", ["applications:read"]);
    expect(await checkToken(null, [])).toEqual({ ok: false, reason: "missing" });
    expect(await checkToken("nope", [])).toEqual({ ok: false, reason: "invalid" });
    expect(await checkToken(`dsr_${"A".repeat(43)}`, [])).toEqual({ ok: false, reason: "invalid" });
    expect(await revokeToken(view.id)).toBe(true);
    expect(await revokeToken(view.id)).toBe(false);
    expect(await checkToken(token, [])).toEqual({ ok: false, reason: "invalid" });
    expect(await listTokens()).toEqual([]);
  });

  it("stops working when the password changes, and says so in the list", async () => {
    const { token } = await createToken("Chrome", ["applications:read"]);
    auth.fingerprint = "pwd-2";
    expect(await checkToken(token, [])).toEqual({ ok: false, reason: "invalid" });
    expect((await listTokens())[0].valid).toBe(false);
  });
});

describe("extRoute", () => {
  const handler = extRoute<unknown>(["applications:read"], async (_request, _context, token) => NextResponse.json({ id: token.id }));
  const call = (headers: Record<string, string> = {}, fn = handler) => fn(new NextRequest("http://localhost/api/ext/test", { headers }), {});

  it("answers a valid bearer token", async () => {
    const { token, view } = await createToken("Chrome", ["applications:read"]);
    const response = await call({ authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: view.id });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("ignores a signed-in session: only a token counts", async () => {
    auth.session = { persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
    const response = await call({ cookie: "dossier_session=whatever" });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("signed-out");
  });

  it("says which way a token fails", async () => {
    const { token } = await createToken("Chrome", ["resume:read"]);
    expect((await (await call({ authorization: `Bearer ${token}` })).json()).error.code).toBe("scope");
    expect((await call({ authorization: "Bearer dsr_wrong" })).status).toBe(401);
  });

  it("turns ExtError into its status, and anything else into a logged 500", async () => {
    const { token } = await createToken("Chrome", ["applications:read"]);
    const notFound = extRoute([], async () => {
      throw new ExtError("not-found", "No such application.");
    });
    const boom = extRoute([], async () => {
      throw new Error("db down");
    });
    const missing = await call({ authorization: `Bearer ${token}` }, notFound);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "not-found", message: "No such application." } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await call({ authorization: `Bearer ${token}` }, boom);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("db down");
    spy.mockRestore();
  });
});

describe("the app's own routes", () => {
  it("still refuse a bearer token without a session", async () => {
    const { token } = await createToken("Chrome", ["applications:read", "applications:write", "resume:read"]);
    const appRoute = route(async () => NextResponse.json({ secret: true }));
    const response = await appRoute(new NextRequest("http://localhost:3000/api/pdf", { headers: { host: "localhost:3000", authorization: `Bearer ${token}` } }), {});
    expect(response.status).toBe(401);
  });
});

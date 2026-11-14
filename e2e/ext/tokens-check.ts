// Fork-only. Drives Settings → Extension & ATS in a real browser against a
// dev server: makes a token, uses it on /api/ext/ping, revokes it, and
// screenshots each state in light and dark. Output in e2e/ext/out/.
//
//   yarn tsx e2e/ext/tokens-check.ts   (dev server on BASE_URL, password DOSSIER_DEV_PASSWORD)

import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.DOSSIER_DEV_PASSWORD ?? "dev-password";
const OUT = new URL("./out/", import.meta.url).pathname;

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`);
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto(`${BASE}/settings?section=extension`);
  await page.getByRole("heading", { name: "Extension & ATS" }).waitFor();
  await page.screenshot({ path: `${OUT}settings-ext-empty.png`, fullPage: true });

  const name = `Chrome ${Date.now()}`;
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Make a token" }).click();
  const code = page.locator("code", { hasText: /^dsr_[A-Za-z0-9_-]{43}$/ });
  await code.waitFor();
  const token = (await code.textContent())?.trim() ?? "";
  check("token shown once after making it", /^dsr_[A-Za-z0-9_-]{43}$/.test(token));
  await page.screenshot({ path: `${OUT}settings-ext-token.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${OUT}settings-ext-token-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  const ping = (headers: Record<string, string>) => fetch(`${BASE}/api/ext/ping`, { headers });
  const ok = await ping({ authorization: `Bearer ${token}` });
  check("ping with the token answers 200 with its scopes", ok.status === 200, JSON.stringify(await ok.json()));
  const cookies = (await context.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const withCookie = await ping({ cookie: cookies });
  check("ping with only the session cookie is refused", withCookie.status === 401, String(withCookie.status));
  const pdfWithToken = await fetch(`${BASE}/api/pdf?doc=base`, { headers: { authorization: `Bearer ${token}` } });
  check("the app's own /api/pdf refuses the token", pdfWithToken.status === 401, String(pdfWithToken.status));

  await page.reload();
  const item = page.getByRole("listitem").filter({ hasText: name });
  await item.waitFor();
  check("token listed after reload, without the token itself", !(await page.content()).includes(token));
  await item.getByRole("button", { name: /Revoke/ }).click();
  await item.waitFor({ state: "detached" });
  const revoked = await ping({ authorization: `Bearer ${token}` });
  check("revoked token is refused with a reconnect message", revoked.status === 401, ((await revoked.json()) as { error: { message: string } }).error.message);
  await page.screenshot({ path: `${OUT}settings-ext-revoked.png`, fullPage: true });

  await browser.close();
  if (results.some(([, passed]) => !passed)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

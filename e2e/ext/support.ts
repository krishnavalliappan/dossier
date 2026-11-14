// Fork-only helpers for the scripts in e2e/ext: a dev server on BASE_URL
// with the demo data, signed in with DOSSIER_DEV_PASSWORD.

import type { Page } from "playwright-core";

export const BASE = process.env.BASE_URL ?? "http://localhost:3100";
export const PASSWORD = process.env.DOSSIER_DEV_PASSWORD ?? "dev-password";
export const OUT = new URL("./out/", import.meta.url).pathname;

export async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Makes a token with every scope in Settings → Extension & ATS, as a person would. */
export async function makeToken(page: Page, name = `Check ${Date.now()}`): Promise<string> {
  await page.goto(`${BASE}/settings?section=extension`);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Make a token" }).click();
  const code = page.locator("code", { hasText: /^dsr_[A-Za-z0-9_-]{43}$/ });
  await code.waitFor();
  return (await code.textContent())!.trim();
}

/** A scorecard as the scripts print it. */
export function scorecard() {
  const rows: [string, boolean, string][] = [];
  return {
    check(name: string, ok: boolean, detail = "") {
      rows.push([name, ok, detail]);
      console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`);
    },
    get failed() {
      return rows.some(([, ok]) => !ok);
    },
  };
}

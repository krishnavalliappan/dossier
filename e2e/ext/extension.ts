// Fork-only: the built extension in Chromium, for the e2e/ext checks. Pages
// are served from files at their real addresses (no request reaches a real
// ATS); Dossier is the dev server; every other request is aborted, so
// nothing is ever sent anywhere.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";

import { jobKey } from "../../src/lib/ext/url";
import { BASE } from "./support";

const DIST = new URL("../../extension/dist/", import.meta.url).pathname;
const FIXTURES = new URL("../../src/lib/ext/page/fixtures/", import.meta.url).pathname;
const SIM = new URL("./sim/", import.meta.url).pathname;

const SYNTHETIC: Record<string, string> = {
  "careers-embed": "https://acme.example/careers/backend-developer",
  "linkedin-signed-in": "https://www.linkedin.com/jobs/view/3998877665/",
  itemlist: "https://acme.example/careers",
};

/** Forgets the jobs at these URLs (saved by an earlier run), so each run saves them anew. The dev server's SQLite only. */
export function forget(urls: string[]) {
  const file = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
  if (!file || process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("Set DATABASE_URL to the dev server's SQLite file.");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON"); // So an application's documents and jobs go with it.
  const keys = urls.map(jobKey).filter(Boolean);
  const marks = keys.map(() => "?").join(", ");
  const ids = (db.prepare(`SELECT applicationId FROM ExtJobUrl WHERE key IN (${marks})`).all(...keys) as { applicationId: string }[]).map((row) => row.applicationId);
  if (ids.length) db.prepare(`DELETE FROM Application WHERE id IN (${ids.map(() => "?").join(", ")})`).run(...ids);
  db.prepare(`DELETE FROM ExtJobUrl WHERE key IN (${marks})`).run(...keys);
  db.close();
}

type Refused = { method: string; url: string };
/** Switched on, Dossier refuses connections (as when it's stopped). */
const outage = { on: false };

export class Rig {
  private constructor(
    readonly context: BrowserContext,
    readonly worker: Worker,
    readonly id: string,
    /** Whether installing opened Options. */
    readonly openedOptions: boolean,
    /** Pages served at their addresses: URL → HTML. */
    readonly pages: Map<string, string>,
    /** Requests refused: anything not served, not Dossier, not the extension. */
    readonly refused: Refused[],
  ) {}

  /** `live`: GETs to pages not served from files go to the real site (reading only; anything else is still refused). */
  static async launch({ live = false } = {}): Promise<Rig> {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
      viewport: { width: 1200, height: 800 },
    });
    const backend = new URL(BASE).host;
    const pages = new Map<string, string>();
    const refused: Refused[] = [];
    const simScript = readFileSync(`${SIM}upload-ui.js`, "utf8");
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = request.url();
      if (new URL(url).host === backend) return outage.on ? route.abort("connectionrefused") : route.continue();
      if (url.startsWith("chrome-extension://")) return route.continue();
      if (request.method() === "GET") {
        if (new URL(url).pathname === "/__sim/upload-ui.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: simScript });
        const page = pages.get(url);
        if (page) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page });
        if (live) return route.continue();
      }
      refused.push({ method: request.method(), url });
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // Installing opens Options, to connect. Chrome may open it in the tab it started with, a moment later: wait for it
    // and close it before opening anything else.
    let options: Page | undefined;
    for (let i = 0; i < 40 && !options; i++) {
      options = context.pages().find((page) => page.url().includes("/options.html"));
      if (!options) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await options?.close();
    return new Rig(context, worker, new URL(worker.url()).host, options !== undefined, pages, refused);
  }

  /** A committed fixture (src/lib/ext/page/fixtures), served at the address it was copied from. */
  fixture(name: string): string {
    const html = readFileSync(`${FIXTURES}${name}.html`, "utf8");
    const url = /<!-- Trimmed copy of (\S+) /.exec(html)?.[1] ?? SYNTHETIC[name];
    if (!url) throw new Error(`No address for fixture ${name}`);
    this.pages.set(url, html);
    return url;
  }

  /** A simulated ATS page (e2e/ext/sim), served at `url`. */
  sim(name: string, url: string, replace: Record<string, string> = {}): string {
    let html = readFileSync(`${SIM}${name}.html`, "utf8");
    for (const [from, to] of Object.entries(replace)) html = html.replaceAll(from, to);
    this.pages.set(url, html);
    return url;
  }

  async tabIdOf(url: string): Promise<number> {
    return this.worker.evaluate(async (wanted) => {
      const { chrome } = globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ id: number; url: string }[]> } } };
      return (await chrome.tabs.query({})).find((tab) => tab.url === wanted)?.id ?? -1;
    }, url);
  }

  async badgeOf(tabId: number): Promise<string> {
    return this.worker.evaluate(async (id) => {
      const { chrome } = globalThis as unknown as { chrome: { action: { getBadgeText(d: object): Promise<string> } } };
      return chrome.action.getBadgeText({ tabId: id });
    }, tabId);
  }

  /** Opens the page, then the popup for its tab (in a tab of its own, 360px wide as the real popup is). */
  async open(url: string, scheme: "light" | "dark" = "light"): Promise<{ page: Page; popup: Page; tabId: number }> {
    const page = await this.context.newPage();
    await page.goto(url);
    const tabId = await this.tabIdOf(page.url());
    const popup = await this.popup(tabId, scheme);
    return { page, popup, tabId };
  }

  async popup(tabId: number, scheme: "light" | "dark" = "light"): Promise<Page> {
    const popup = await this.context.newPage();
    await popup.setViewportSize({ width: 360, height: 560 });
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.goto(`chrome-extension://${this.id}/popup.html?tab=${tabId}`);
    await popup.locator("main").waitFor();
    await popup.waitForFunction(() => !document.querySelector(".spinner"), undefined, { timeout: 20_000 });
    return popup;
  }

  /** Options → address and token → Connect; what it said. */
  async connect(server: string, token: string): Promise<string> {
    const options = await this.context.newPage();
    await options.goto(`chrome-extension://${this.id}/options.html`);
    await options.getByLabel("Dossier's address").fill(server);
    await options.getByLabel("Token").fill(token);
    await options.getByRole("button", { name: /Connect|Save and check/ }).click();
    await options.waitForFunction(() => !/Checking/.test(document.getElementById("status")?.textContent ?? ""), undefined, { timeout: 20_000 });
    const status = (await options.locator("#status").textContent()) ?? "";
    await options.close();
    return status;
  }

  /** Dossier stops answering (true) or comes back (false). */
  outage(on: boolean) {
    outage.on = on;
  }

  /** Points the extension at another address without checking it (for "Dossier is down"). */
  async setServer(server: string) {
    const scratch = await this.context.newPage();
    await scratch.goto(`chrome-extension://${this.id}/options.html`);
    await scratch.evaluate((value) => (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } }).chrome.storage.local.set({ server: value }), server);
    await scratch.close();
  }
}

/** A screenshot of the popup, as tall as what's in it. */
export const shot = (popup: Page, path: string) => popup.locator("#app").screenshot({ path });

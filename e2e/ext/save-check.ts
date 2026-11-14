// Fork-only: the extension's "recognize and save", for real. Loads the built
// extension (node extension/build.mjs --test) into Chromium, connects it to
// the dev server with a token, and opens its popup on job pages: committed
// copies of public pages, served at their own addresses so no request
// reaches a real ATS. Nothing is ever submitted: requests to any other site
// are aborted.
//
//   node extension/build.mjs --test && yarn tsx e2e/ext/save-check.ts
//   LIVE=1 ...    also reads the live pages the fixtures were copied from (GETs only; nothing is sent to them)
//
// Screenshots of every popup state, light and dark, go to e2e/ext/out/save/.

import { mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";

import { jobKey } from "../../src/lib/ext/url";
import { BASE, makeToken, OUT, scorecard, signIn } from "./support";

const DIST = new URL("../../extension/dist/", import.meta.url).pathname;
const FIXTURES = new URL("../../src/lib/ext/page/fixtures/", import.meta.url).pathname;
const SHOTS = `${OUT}save/`;
mkdirSync(SHOTS, { recursive: true });

const SYNTHETIC: Record<string, string> = {
  "careers-embed": "https://acme.example/careers/backend-developer",
  "linkedin-signed-in": "https://www.linkedin.com/jobs/view/3998877665/",
  itemlist: "https://acme.example/careers",
};
const pages = new Map<string, string>();
function fixtureUrl(name: string): string {
  const html = readFileSync(`${FIXTURES}${name}.html`, "utf8");
  const url = /<!-- Trimmed copy of (\S+) /.exec(html)?.[1] ?? SYNTHETIC[name];
  pages.set(url, html);
  return url;
}

const card = scorecard();
const LIVE = process.env.LIVE === "1";

/** Forgets the jobs these pages are (applications saved by an earlier run), so each run saves them anew. Dev SQLite only. */
function forget(urls: string[]) {
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
const backend = new URL(BASE);

async function launch(): Promise<{ context: BrowserContext; worker: Worker; id: string }> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    viewport: { width: 1200, height: 800 },
  });
  // Job pages come from the fixtures; Dossier is the dev server; anything else is refused, so nothing is sent anywhere.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const page = pages.get(url);
    if (new URL(url).host === backend.host || url.startsWith("chrome-extension://")) return route.continue();
    // Live: the real pages, read only. Anything but a GET to them (a form post) is refused.
    if (LIVE && route.request().method() === "GET" && !page) return route.continue();
    if (page && route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page });
    return route.abort("blockedbyclient");
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  // Installing opens Options, to connect: once, then out of the way.
  // (Chrome may open it in the tab it started with, a moment later: wait for it before opening anything else.)
  let options: Page | undefined;
  for (let i = 0; i < 40 && !options; i++) {
    options = context.pages().find((page) => page.url().includes("/options.html"));
    if (!options) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  card.check("installing opens Options to connect", options !== undefined);
  await options?.close();
  return { context, worker, id };
}

async function tabIdOf(worker: Worker, url: string): Promise<number> {
  return worker.evaluate(async (wanted) => {
    const { chrome } = globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ id: number; url: string }[]> } } };
    return (await chrome.tabs.query({})).find((tab) => tab.url === wanted)?.id ?? -1;
  }, url);
}

async function badgeOf(worker: Worker, tabId: number): Promise<string> {
  return worker.evaluate(async (id) => {
    const { chrome } = globalThis as unknown as { chrome: { action: { getBadgeText(d: object): Promise<string> } } };
    return chrome.action.getBadgeText({ tabId: id });
  }, tabId);
}

/** Opens the page, then the popup for its tab (a tab of its own, 360px wide as the real popup is). */
async function popupFor(context: BrowserContext, worker: Worker, id: string, url: string, scheme: "light" | "dark" = "light"): Promise<{ page: Page; popup: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await tabIdOf(worker, page.url());
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 560 });
  await popup.emulateMedia({ colorScheme: scheme });
  await popup.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
  await popup.locator("main").waitFor();
  await popup.waitForFunction(() => !document.querySelector(".spinner"), undefined, { timeout: 20_000 });
  return { page, popup, tabId };
}

async function shot(popup: Page, name: string) {
  // The popup is as tall as what's in it.
  await popup.locator("#app").screenshot({ path: `${SHOTS}${name}.png` });
}

async function connect(context: BrowserContext, id: string, server: string, token: string): Promise<string> {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel("Dossier's address").fill(server);
  await options.getByLabel("Token").fill(token);
  await options.getByRole("button", { name: /Connect|Save and check/ }).click();
  await options.waitForFunction(() => !/Checking/.test(document.getElementById("status")?.textContent ?? ""), undefined, { timeout: 20_000 });
  const status = (await options.locator("#status").textContent()) ?? "";
  await options.close();
  return status;
}

async function main() {
  const signedIn = await chromium.launch();
  const app = await signedIn.newPage();
  await signIn(app);
  const token = await makeToken(app, `Save check ${Date.now()}`);

  forget(["greenhouse-posting", "lever-posting", "linkedin-signed-in", "linkedin-view", "careers-embed", "ashby-posting", "not-a-job"].map(fixtureUrl));
  const { context, worker, id } = await launch();

  // Not connected yet.
  {
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("greenhouse-posting"));
    card.check("not connected: says so, one button to connect", (await popup.getByRole("button", { name: "Connect to Dossier" }).count()) === 1);
    await shot(popup, "01-not-connected");
    await Promise.all([popup.close(), page.close()]);
  }

  // Options: a bad address and a bad token are caught before anything is sent; then it connects.
  {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByLabel("Dossier's address").fill("dossier");
    await options.getByLabel("Token").fill(token);
    await options.getByRole("button", { name: "Connect" }).click();
    card.check("options: an address that isn't one is refused", /isn't a web address/.test((await options.locator("#status").textContent()) ?? ""));
    await options.getByLabel("Dossier's address").fill(BASE);
    await options.getByLabel("Token").fill("not-a-token");
    await options.getByRole("button", { name: "Connect" }).click();
    card.check("options: a token that isn't one is refused", /isn't a Dossier token/.test((await options.locator("#status").textContent()) ?? ""));
    await options.screenshot({ path: `${SHOTS}02-options-error.png`, fullPage: true });
    await options.close();
  }
  const connected = await connect(context, id, `${BASE}/some/path`, token);
  card.check("options: connects, and says what the token can do", /Connected to Dossier .* look up saved jobs, save jobs and mark them applied, download tailored PDFs/.test(connected), connected);
  {
    const options = await context.newPage();
    for (const scheme of ["light", "dark"] as const) {
      await options.emulateMedia({ colorScheme: scheme });
      await options.goto(`chrome-extension://${id}/options.html`);
      await options.waitForFunction(() => /Connected/.test(document.getElementById("status")?.textContent ?? ""));
      await options.screenshot({ path: `${SHOTS}03-options-connected-${scheme}.png`, fullPage: true });
    }
    card.check("options: keeps the origin, not the path typed", (await options.getByLabel("Dossier's address").inputValue()) === BASE);
    await options.close();
  }

  // A Greenhouse posting with its form: details read, saved with tailoring, then shown as saved.
  const greenhouse = fixtureUrl("greenhouse-posting");
  {
    const { popup, page, tabId } = await popupFor(context, worker, id, greenhouse);
    card.check("badge before saving: + (a job to save)", (await badgeOf(worker, tabId)) === "+", await badgeOf(worker, tabId));
    card.check("Greenhouse posting: says what the page is", (await popup.locator("#what").textContent()) === "Greenhouse · Application form", (await popup.locator("#what").textContent()) ?? "");
    const fields = { title: await popup.getByLabel("Job title").inputValue(), company: await popup.getByLabel("Company").inputValue(), location: await popup.getByLabel("Location").inputValue() };
    card.check("Greenhouse posting: title, company and location read from the page", fields.title === "AI Transformation Owner, CRO" && fields.company === "GitLab" && fields.location === "Remote, United States", JSON.stringify(fields));
    card.check("Save is focused, so Enter saves", await popup.evaluate(() => document.activeElement?.id === "save"));
    await shot(popup, "04-new-greenhouse-light");
    await popup.emulateMedia({ colorScheme: "dark" });
    await shot(popup, "04-new-greenhouse-dark");
    await popup.emulateMedia({ colorScheme: "light" });
    await popup.keyboard.press("Enter");
    await popup.getByText(/Saved as a Draft/).waitFor({ timeout: 20_000 });
    card.check("saved: a Draft, and its documents being written", (await popup.locator(".status").textContent())?.includes("Draft") === true && (await popup.locator(".doc.writing").count()) > 0);
    await shot(popup, "05-saved-writing");
    await popup.locator(".doc.writing").first().waitFor({ state: "detached", timeout: 240_000 });
    await popup.locator(".doc.writing").waitFor({ state: "detached", timeout: 240_000 }).catch(() => {});
    card.check("saved: the popup shows when the resume and letter are ready", (await popup.locator(".doc.ready").count()) === 2, `${await popup.locator(".doc.ready").count()} ready`);
    await shot(popup, "06-saved-ready-light");
    await popup.emulateMedia({ colorScheme: "dark" });
    await shot(popup, "06-saved-ready-dark");
    await page.reload();
    await page.waitForTimeout(1500);
    card.check("badge after saving: ✓", (await badgeOf(worker, tabId)) === "✓", await badgeOf(worker, tabId));
    await Promise.all([popup.close(), page.close()]);
  }

  // The same job again: found, not saved twice.
  {
    const { popup, page } = await popupFor(context, worker, id, greenhouse);
    card.check("same job again: shown as saved, no second save", (await popup.getByRole("button", { name: "Open in Dossier" }).count()) === 1 && (await popup.getByRole("button", { name: "Save to Dossier" }).count()) === 0);
    await Promise.all([popup.close(), page.close()]);
  }

  // Lever: saved from its posting without tailoring; its /apply form then finds it.
  {
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("lever-posting"));
    await popup.getByLabel("Write the resume and cover letter now").uncheck();
    await popup.getByRole("button", { name: "Save to Dossier" }).click();
    await popup.getByText("Saved as a Draft.").waitFor({ timeout: 20_000 });
    card.check("saved without tailoring: says no resume yet, offers to write it", (await popup.getByText("No resume yet").count()) === 1 && (await popup.getByRole("button", { name: "Write now" }).count()) === 1);
    await shot(popup, "07-saved-no-tailor");
    await Promise.all([popup.close(), page.close()]);
    const form = await popupFor(context, worker, id, fixtureUrl("lever-apply"));
    card.check("Lever /apply finds the job saved from its posting", (await form.popup.locator("#what").textContent()) === "Lever · Application form" && (await form.popup.getByText("Administrative Business Partner").count()) === 1);
    card.check("badge on a saved job's application form: ⇪", (await badgeOf(worker, form.tabId)) === "⇪", await badgeOf(worker, form.tabId));
    await Promise.all([form.popup.close(), form.page.close()]);
  }

  // LinkedIn: the company's own posting when Apply links to it; else the LinkedIn link, with a warning.
  {
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("linkedin-signed-in"));
    card.check("LinkedIn linking to Greenhouse: saves the company's posting, says where it was found", (await popup.getByText("Saves the company's own posting on Greenhouse, not the LinkedIn copy.").count()) === 1 && (await popup.locator("#what").textContent()) === "LinkedIn · Job posting");
    await shot(popup, "08-linkedin-to-greenhouse");
    await Promise.all([popup.close(), page.close()]);
    const view = await popupFor(context, worker, id, fixtureUrl("linkedin-view"));
    card.check("LinkedIn without a company link: warns it saves the LinkedIn link", (await view.popup.getByText(/saves the LinkedIn one/).count()) === 1 && (await view.popup.getByLabel("Company").inputValue()) === "d1g1t");
    await shot(view.popup, "09-linkedin-warning");
    await Promise.all([view.popup.close(), view.page.close()]);
  }

  // A careers page with Greenhouse embedded: the embed's job.
  {
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("careers-embed"));
    card.check("careers page with an embedded Greenhouse form: read as that job's form", (await popup.locator("#what").textContent()) === "Greenhouse · Application form");
    await Promise.all([popup.close(), page.close()]);
  }

  // Lists and pages that aren't jobs.
  for (const [name, expected] of [["greenhouse-board", "This page lists many jobs"], ["lever-board", "This page lists many jobs"], ["itemlist", "This page lists many jobs"]] as const) {
    const { popup, page, tabId } = await popupFor(context, worker, id, fixtureUrl(name));
    card.check(`${name}: a list, says to open one job`, (await popup.getByText(expected).count()) === 1 && (await popup.getByRole("button").count()) === 1);
    if (name === "greenhouse-board") {
      card.check("badge on a list: ≡", (await badgeOf(worker, tabId)) === "≡", await badgeOf(worker, tabId));
      await shot(popup, "10-list");
    }
    await Promise.all([popup.close(), page.close()]);
  }
  {
    const { popup, page, tabId } = await popupFor(context, worker, id, fixtureUrl("not-a-job"));
    card.check("an article: not a job page, with Save it anyway", (await popup.getByText("This page doesn't look like a job posting.").count()) === 1 && (await badgeOf(worker, tabId)) === "");
    await shot(popup, "11-not-a-job");
    await popup.getByRole("button", { name: "Save it anyway" }).click();
    await popup.getByRole("button", { name: "Save to Dossier" }).waitFor();
    card.check("Save it anyway: the form, with a warning to check it", (await popup.getByText(/didn't look like a job posting/).count()) === 1);
    await Promise.all([popup.close(), page.close()]);
  }

  // Failures say what to do.
  {
    await context.newPage().then(async (scratch) => {
      await scratch.goto(`chrome-extension://${id}/options.html`);
      await scratch.evaluate(() => (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } }).chrome.storage.local.set({ server: "http://localhost:3199" }));
      await scratch.close();
    });
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("ashby-posting"));
    card.check("Dossier down: says it can't reach it, offers Try again", (await popup.getByText(/Can't reach Dossier at http:\/\/localhost:3199/).count()) === 1 && (await popup.getByRole("button", { name: "Try again" }).count()) === 1);
    await shot(popup, "12-offline");
    await Promise.all([popup.close(), page.close()]);
  }
  {
    // A token revoked in Dossier.
    await connect(context, id, BASE, token);
    await app.goto(`${BASE}/settings?section=extension`);
    await app.getByRole("button", { name: /^Revoke Save check/ }).first().click();
    await app.waitForTimeout(1000);
    const { popup, page } = await popupFor(context, worker, id, fixtureUrl("ashby-posting"));
    card.check("revoked token: says so, sends to Options", (await popup.getByRole("button", { name: "Open Options" }).count()) === 1, (await popup.locator(".notice").textContent()) ?? "");
    await shot(popup, "13-revoked");
    await Promise.all([popup.close(), page.close()]);
  }

  if (LIVE) {
    await connect(context, id, BASE, await makeToken(app, `Save check live ${Date.now()}`));
    // The pages the fixtures came from, as they are today: read the same way, or the fixtures are stale.
    const live: [string, string, RegExp][] = [
      ["https://job-boards.greenhouse.io/gitlab/jobs/8638232002", "Greenhouse · Application form", /GitLab/],
      ["https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd", "Lever · Job posting", /Palantir/],
      ["https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff", "Ashby · Job posting", /Linear/],
      ["https://www.linkedin.com/jobs/view/4433442194/", "LinkedIn · Job posting", /d1g1t/],
      ["https://job-boards.greenhouse.io/gitlab", "Greenhouse · Job list", /./],
    ];
    for (const [url, what, company] of live) {
      pages.delete(url);
      const { popup, page } = await popupFor(context, worker, id, url);
      const said = (await popup.locator("#what").textContent()) ?? "";
      const companyField = popup.getByLabel("Company");
      const read = (await companyField.count()) ? await companyField.inputValue() : (await popup.locator(".card .muted").first().textContent().catch(() => "")) ?? "";
      card.check(`live ${new URL(url).hostname}: ${what}`, said === what && (what.endsWith("Job list") || company.test(read)), `${said}; company ${read || "(saved)"}`);
      await shot(popup, `live-${new URL(url).hostname}`);
      await Promise.all([popup.close(), page.close()]);
    }
  }

  await context.close();
  await signedIn.close();
}

main().then(
  () => process.exit(card.failed ? 1 : 0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

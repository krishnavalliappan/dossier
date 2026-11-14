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

import { mkdirSync } from "node:fs";

import { chromium, type Page } from "playwright-core";

import { forget, Rig, shot as shotTo } from "./extension";
import { BASE, makeToken, OUT, scorecard, signIn } from "./support";

const SHOTS = `${OUT}save/`;
mkdirSync(SHOTS, { recursive: true });

const card = scorecard();
const LIVE = process.env.LIVE === "1";
const shot = (popup: Page, name: string) => shotTo(popup, `${SHOTS}${name}.png`);

async function main() {
  const signedIn = await chromium.launch();
  const app = await signedIn.newPage();
  await signIn(app);
  const token = await makeToken(app, `Save check ${Date.now()}`);

  const rig = await Rig.launch({ live: LIVE });
  const { context, id } = rig;
  const fixtureUrl = (name: string) => rig.fixture(name);
  forget(["greenhouse-posting", "lever-posting", "linkedin-signed-in", "linkedin-view", "careers-embed", "ashby-posting", "not-a-job"].map(fixtureUrl));
  card.check("installing opens Options to connect", rig.openedOptions);

  // Not connected yet.
  {
    const { popup, page } = await rig.open(fixtureUrl("greenhouse-posting"));
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
  const connected = await rig.connect(`${BASE}/some/path`, token);
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
    const { popup, page, tabId } = await rig.open(greenhouse);
    card.check("badge before saving: + (a job to save)", (await rig.badgeOf(tabId)) === "+", await rig.badgeOf(tabId));
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
    card.check("badge after saving: ✓", (await rig.badgeOf(tabId)) === "✓", await rig.badgeOf(tabId));
    await Promise.all([popup.close(), page.close()]);
  }

  // The same job again: found, not saved twice.
  {
    const { popup, page } = await rig.open(greenhouse);
    card.check("same job again: shown as saved, no second save", (await popup.getByRole("button", { name: "Open in Dossier" }).count()) === 1 && (await popup.getByRole("button", { name: "Save to Dossier" }).count()) === 0);
    await Promise.all([popup.close(), page.close()]);
  }

  // Lever: saved from its posting without tailoring; its /apply form then finds it.
  {
    const { popup, page } = await rig.open(fixtureUrl("lever-posting"));
    await popup.getByLabel("Write the resume and cover letter now").uncheck();
    await popup.getByRole("button", { name: "Save to Dossier" }).click();
    await popup.getByText("Saved as a Draft.").waitFor({ timeout: 20_000 });
    card.check("saved without tailoring: says no resume yet, offers to write it", (await popup.getByText("No resume yet").count()) === 1 && (await popup.getByRole("button", { name: "Write now" }).count()) === 1);
    await shot(popup, "07-saved-no-tailor");
    await Promise.all([popup.close(), page.close()]);
    const form = await rig.open(fixtureUrl("lever-apply"));
    card.check("Lever /apply finds the job saved from its posting", (await form.popup.locator("#what").textContent()) === "Lever · Application form" && (await form.popup.getByText("Administrative Business Partner").count()) === 1);
    card.check("badge on a saved job's application form: ⇪", (await rig.badgeOf(form.tabId)) === "⇪", await rig.badgeOf(form.tabId));
    await Promise.all([form.popup.close(), form.page.close()]);
  }

  // LinkedIn: the company's own posting when Apply links to it; else the LinkedIn link, with a warning.
  {
    const { popup, page } = await rig.open(fixtureUrl("linkedin-signed-in"));
    card.check("LinkedIn linking to Greenhouse: saves the company's posting, says where it was found", (await popup.getByText("Saves the company's own posting on Greenhouse, not the LinkedIn copy.").count()) === 1 && (await popup.locator("#what").textContent()) === "LinkedIn · Job posting");
    await shot(popup, "08-linkedin-to-greenhouse");
    await Promise.all([popup.close(), page.close()]);
    const view = await rig.open(fixtureUrl("linkedin-view"));
    card.check("LinkedIn without a company link: warns it saves the LinkedIn link", (await view.popup.getByText(/saves the LinkedIn one/).count()) === 1 && (await view.popup.getByLabel("Company").inputValue()) === "d1g1t");
    await shot(view.popup, "09-linkedin-warning");
    await Promise.all([view.popup.close(), view.page.close()]);
  }

  // A careers page with Greenhouse embedded: the embed's job.
  {
    const { popup, page } = await rig.open(fixtureUrl("careers-embed"));
    card.check("careers page with an embedded Greenhouse form: read as that job's form", (await popup.locator("#what").textContent()) === "Greenhouse · Application form");
    await Promise.all([popup.close(), page.close()]);
  }

  // Lists and pages that aren't jobs.
  for (const [name, expected] of [["greenhouse-board", "This page lists many jobs"], ["lever-board", "This page lists many jobs"], ["itemlist", "This page lists many jobs"]] as const) {
    const { popup, page, tabId } = await rig.open(fixtureUrl(name));
    card.check(`${name}: a list, says to open one job`, (await popup.getByText(expected).count()) === 1 && (await popup.getByRole("button").count()) === 1);
    if (name === "greenhouse-board") {
      card.check("badge on a list: ≡", (await rig.badgeOf(tabId)) === "≡", await rig.badgeOf(tabId));
      await shot(popup, "10-list");
    }
    await Promise.all([popup.close(), page.close()]);
  }
  {
    const { popup, page, tabId } = await rig.open(fixtureUrl("not-a-job"));
    card.check("an article: not a job page, with Save it anyway", (await popup.getByText("This page doesn't look like a job posting.").count()) === 1 && (await rig.badgeOf(tabId)) === "");
    await shot(popup, "11-not-a-job");
    await popup.getByRole("button", { name: "Save it anyway" }).click();
    await popup.getByRole("button", { name: "Save to Dossier" }).waitFor();
    card.check("Save it anyway: the form, with a warning to check it", (await popup.getByText(/didn't look like a job posting/).count()) === 1);
    await Promise.all([popup.close(), page.close()]);
  }

  // Failures say what to do.
  {
    await rig.setServer("http://localhost:3199");
    const { popup, page } = await rig.open(fixtureUrl("ashby-posting"));
    card.check("Dossier down: says it can't reach it, offers Try again", (await popup.getByText(/Can't reach Dossier at http:\/\/localhost:3199/).count()) === 1 && (await popup.getByRole("button", { name: "Try again" }).count()) === 1);
    await shot(popup, "12-offline");
    await Promise.all([popup.close(), page.close()]);
  }
  {
    // A token revoked in Dossier.
    await rig.connect(BASE, token);
    await app.goto(`${BASE}/settings?section=extension`);
    await app.getByRole("button", { name: /^Revoke Save check/ }).first().click();
    await app.waitForTimeout(1000);
    const { popup, page } = await rig.open(fixtureUrl("ashby-posting"));
    card.check("revoked token: says so, sends to Options", (await popup.getByRole("button", { name: "Open Options" }).count()) === 1, (await popup.locator(".notice").textContent()) ?? "");
    await shot(popup, "13-revoked");
    await Promise.all([popup.close(), page.close()]);
  }

  if (LIVE) {
    await rig.connect(BASE, await makeToken(app, `Save check live ${Date.now()}`));
    // The pages the fixtures came from, as they are today: read the same way, or the fixtures are stale.
    const live: [string, string, RegExp][] = [
      ["https://job-boards.greenhouse.io/gitlab/jobs/8638232002", "Greenhouse · Application form", /GitLab/],
      ["https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd", "Lever · Job posting", /Palantir/],
      ["https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff", "Ashby · Job posting", /Linear/],
      ["https://www.linkedin.com/jobs/view/4433442194/", "LinkedIn · Job posting", /d1g1t/],
      ["https://job-boards.greenhouse.io/gitlab", "Greenhouse · Job list", /./],
    ];
    for (const [url, what, company] of live) {
      rig.pages.delete(url);
      const { popup, page } = await rig.open(url);
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

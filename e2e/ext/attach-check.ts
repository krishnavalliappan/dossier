// Fork-only: the extension's "attach", for real. The built extension
// (node extension/build.mjs --test) in Chromium against the dev server,
// on simulated ATS application forms (e2e/ext/sim) served at ATS-shaped
// addresses: a Greenhouse form with a resume another extension attached, a
// form that submits itself on change, a Greenhouse form embedded in a
// careers page, a Workday drop zone, a form that shows after a click, and a
// LinkedIn page. Demo profile only. Nothing is submitted: the pages' own
// submit counters must stay at zero, and every request to another site is
// aborted (and must not be a POST).
//
//   node extension/build.mjs --test && yarn tsx e2e/ext/attach-check.ts
//
// Screenshots go to e2e/ext/out/attach/.

import { mkdirSync } from "node:fs";

import { chromium, type Frame, type Page } from "playwright-core";

import type { ExtApplication, SaveResult } from "../../extension/src/api";
import { forget, Rig, shot as shotTo } from "./extension";
import { BASE, makeToken, OUT, scorecard, signIn } from "./support";

const SHOTS = `${OUT}attach/`;
mkdirSync(SHOTS, { recursive: true });
const card = scorecard();
const shot = (popup: Page, name: string) => shotTo(popup, `${SHOTS}${name}.png`);

const URLS = {
  greenhouse: "https://job-boards.greenhouse.io/acmesim/jobs/4099999001",
  autosubmit: "https://job-boards.greenhouse.io/acmesim/jobs/4099999003",
  writing: "https://job-boards.greenhouse.io/acmesim/jobs/4099999004",
  untailored: "https://job-boards.greenhouse.io/acmesim/jobs/4099999005",
  careers: "https://careers.acmesim.example/jobs/backend",
  embed: "https://job-boards.greenhouse.io/embed/job_app?for=acmesim&token=4099999002",
  workday: "https://acmesim.wd3.myworkdayjobs.com/en-US/External/job/Toronto/Backend-Developer_R4099999/apply",
  workdayFoundOn: "https://www.linkedin.com/jobs/view/4099999010/",
  late: "https://jobs.lever.co/acmesim/2b3c4d5e-0000-4abc-8def-109999999999",
  linkedin: "https://www.linkedin.com/jobs/view/4099999009/",
};

/** What a simulated form's page saw: the files each upload shows, and whether anything was submitted. */
async function formState(frame: Page | Frame) {
  return frame.evaluate(async () => {
    const sim = (window as unknown as { sim: { changes: number; drops: number; submitted: number } }).sim;
    const uploads = await Promise.all([...document.querySelectorAll("[data-upload]")].map(async (upload) => {
      const input = upload.querySelector<HTMLInputElement>("input[type=file]")!;
      const file = input.files?.[0];
      return {
        shown: [...upload.querySelectorAll(".files li")].map((item) => item.textContent),
        files: input.files?.length ?? 0,
        name: file?.name ?? "",
        type: file?.type ?? "",
        size: file?.size ?? 0,
        head: file ? new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) : "",
      };
    }));
    return { ...sim, uploads };
  });
}

/** Waits for the attach to finish: what it attached, or (failing the check that follows) the error it showed. */
async function attached(popup: Page) {
  await popup.locator("#attached, [role=alert]").first().waitFor({ timeout: 300_000 });
  const alert = popup.getByRole("alert");
  if (await alert.count()) throw new Error(`Attach failed: ${await alert.textContent()}`);
}

async function main() {
  forget(Object.values(URLS));
  const browser = await chromium.launch();
  const dossier = await browser.newPage();
  await signIn(dossier);
  const token = await makeToken(dossier, `Attach check ${Date.now()}`);
  const api = async <T>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${BASE}/api/ext${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
    return (await response.json()) as T;
  };
  const save = (url: string, company: string, tailor = true) => api<SaveResult>("/applications", { method: "POST", body: JSON.stringify({ url, title: "Backend Developer", company, location: "Toronto, ON", description: "Acme Sim builds logistics software in Python.", tailor }) });
  const ready = async (id: string) => {
    for (let i = 0; i < 120; i++) {
      const { application } = await api<{ application: ExtApplication }>(`/applications/${id}`);
      if (application.resume !== "writing" && application.letter !== "writing") return application;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Documents for ${id} never finished.`);
  };

  const rig = await Rig.launch();
  await rig.connect(BASE, token);
  rig.sim("greenhouse-form", URLS.greenhouse);
  rig.sim("greenhouse-form", URLS.autosubmit, { __AUTOSUBMIT__: "on" });
  rig.sim("greenhouse-form", URLS.writing);
  rig.sim("greenhouse-form", URLS.untailored);
  rig.sim("greenhouse-form", URLS.embed);
  rig.sim("careers-embed", URLS.careers);
  rig.sim("workday-form", URLS.workday);
  rig.sim("late-form", URLS.late);
  rig.sim("linkedin-upload", URLS.linkedin);

  const greenhouse = await save(URLS.greenhouse, "Acme Sim");
  const autosubmit = await save(URLS.autosubmit, "Acme Sim Two");
  const embedded = await save(URLS.embed, "Acme Sim Embedded");
  const late = await save(URLS.late, "Acme Sim Lever");
  const fromLinkedIn = await save(URLS.workdayFoundOn, "Acme Sim Workday");
  await save(URLS.linkedin, "Acme Sim");
  await save(URLS.untailored, "Acme Sim Untailored", false);
  await Promise.all([greenhouse, autosubmit, embedded, late, fromLinkedIn].map((saved) => ready(saved.application.id)));

  // Greenhouse: replaces the resume another extension attached, adds the cover letter, never submits.
  {
    const { popup, page } = await rig.open(URLS.greenhouse);
    const attach = popup.getByRole("button", { name: "Attach resume and cover letter" });
    card.check("saved job's form: one main action, Attach resume and cover letter (focused)", (await attach.count()) === 1 && (await popup.evaluate(() => document.activeElement?.id === "main-action")));
    await shot(popup, "01-ready-to-attach");
    await attach.click();
    await attached(popup);
    const said = (await popup.locator("#attached").textContent()) ?? "";
    const state = await formState(page);
    const [resume, letter] = state.uploads;
    card.check("replaces the file already attached, and says so", /^Replaced Simplify-Resume\.pdf with .+Resume\.pdf\./.test(said), said);
    card.check("resume field holds one file, ours, and the page shows only ours", resume.files === 1 && resume.shown.length === 1 && resume.shown[0] === resume.name && /Resume\.pdf$/.test(resume.name), JSON.stringify(resume.shown));
    card.check("cover letter in its own field", letter.files === 1 && /Cover Letter\.pdf$|Letter\.pdf$/i.test(letter.name) && letter.shown[0] === letter.name, letter.name);
    card.check("the files are real PDFs: application/pdf, %PDF-, sane size", [resume, letter].every((upload) => upload.type === "application/pdf" && upload.head === "%PDF-" && upload.size > 5_000 && upload.size < 2_000_000), `${resume.size} / ${letter.size} bytes`);
    card.check("named with the company", resume.name.includes("Acme Sim"), resume.name);
    card.check("nothing submitted", state.submitted === 0);
    card.check("then one main action: Mark applied, with a reminder to submit yourself", (await popup.getByRole("button", { name: "Mark applied" }).count()) === 1 && (await popup.getByText("Check the form and submit it yourself, then mark it applied.").count()) === 1);
    await shot(popup, "02-attached-light");
    await popup.emulateMedia({ colorScheme: "dark" });
    await shot(popup, "02-attached-dark");
    await popup.emulateMedia({ colorScheme: "light" });

    await popup.getByRole("button", { name: "Attach again" }).click();
    await popup.getByText(/^Attached .+Resume\.pdf\.$/).first().waitFor({ timeout: 150_000 });
    const again = await formState(page);
    card.check("attaching twice: still one file, shown once", again.uploads[0].files === 1 && again.uploads[0].shown.length === 1 && again.submitted === 0);

    await popup.getByRole("button", { name: "Mark applied" }).click();
    await popup.getByText(/Marked as applied\. It's Sent in Dossier\./).waitFor();
    const { application } = await api<{ application: ExtApplication }>(`/applications/${greenhouse.application.id}`);
    card.check("Mark applied: Sent in Dossier", application.status === "SENT");
    await shot(popup, "03-marked-applied");
    await Promise.all([popup.close(), page.close()]);
  }

  // A form that submits itself when a field changes: held back, and said.
  {
    const { popup, page } = await rig.open(URLS.autosubmit);
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await attached(popup);
    const state = await formState(page);
    card.check("a form that submits on change: not submitted, and the popup says it tried", state.submitted === 0 && (await popup.getByText(/tried to send the form while attaching; it was held back/).count()) === 1, `submitted ${state.submitted}`);
    await shot(popup, "04-submit-held");
    await Promise.all([popup.close(), page.close()]);
  }

  // A Greenhouse form embedded in a careers page: attached inside the frame.
  {
    const { popup, page } = await rig.open(URLS.careers);
    card.check("careers page with an embedded form: finds the saved job, offers Attach", (await popup.getByRole("button", { name: /^Attach resume/ }).count()) === 1, (await popup.locator("#what").textContent()) ?? "");
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await attached(popup);
    const frame = page.frames().find((candidate) => candidate.url().startsWith("https://job-boards.greenhouse.io/embed/"))!;
    const state = await formState(frame);
    card.check("embedded form: the resume is in the frame's field", state.uploads[0].files === 1 && /Resume\.pdf$/.test(state.uploads[0].name) && state.submitted === 0, state.uploads[0].name);
    await Promise.all([popup.close(), page.close()]);
  }

  // Workday, for a job saved from LinkedIn: link the form to it, then attach through the drop zone once.
  {
    const { popup, page } = await rig.open(URLS.workday);
    const suggestion = popup.getByRole("button", { name: /Backend Developer · Acme Sim Workday/ });
    await suggestion.waitFor({ timeout: 10_000 }).catch(() => {});
    card.check("an unknown form: offers the saved job it may be", (await suggestion.count()) === 1);
    await shot(popup, "05-link-suggestion");
    await suggestion.click();
    await popup.getByText("Linked this form to the saved job.").waitFor();
    const linked = await api<{ matches: ExtApplication[] }>(`/applications/lookup?url=${encodeURIComponent(URLS.workday)}`);
    card.check("linked: the form now finds the job", linked.matches[0]?.id === fromLinkedIn.application.id);
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await attached(popup);
    const state = await formState(page);
    card.check("Workday drop zone: one file listed, not two (change and drop)", state.uploads[0].files === 1 && state.uploads[0].shown.length === 1 && state.submitted === 0, JSON.stringify({ shown: state.uploads[0].shown, drops: state.drops }));
    await Promise.all([popup.close(), page.close()]);
  }

  // The form shows only after a click: says so, and Look again finds it.
  {
    const { popup, page } = await rig.open(URLS.late);
    card.check("a posting with its form a click away: says to open it, then Look again", (await popup.getByText("To attach the resume, open the application form, then look again.").count()) === 1 && (await popup.getByRole("button", { name: "Look again" }).count()) === 1);
    await shot(popup, "06-look-again");
    await page.click("#show-form");
    await popup.getByRole("button", { name: "Look again" }).click();
    await popup.getByRole("button", { name: /^Attach resume/ }).waitFor();
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await attached(popup);
    card.check("…and attaches once it's there", (await formState(page)).uploads[0].files === 1);
    await Promise.all([popup.close(), page.close()]);
  }

  // LinkedIn: never attaches, even with an upload on the page.
  {
    const { popup, page } = await rig.open(URLS.linkedin);
    card.check("LinkedIn: no Attach, even with an upload on the page", (await popup.getByRole("button", { name: /Attach/ }).count()) === 0 && (await popup.getByRole("button", { name: "Open in Dossier" }).count()) === 1);
    card.check("LinkedIn: its upload left empty", (await formState(page)).uploads[0].files === 0);
    await Promise.all([popup.close(), page.close()]);
  }

  // Not written yet: Attach waits for the resume; never written: Write now.
  {
    await save(URLS.writing, "Acme Sim Writing");
    const { popup, page } = await rig.open(URLS.writing);
    const attach = popup.getByRole("button", { name: /^Attach resume/ });
    card.check("resume being written: Attach shown but disabled, says why", (await attach.isDisabled()) && (await popup.getByText("Attach is ready once the resume is.").count()) === 1);
    await shot(popup, "07-waiting-for-resume");
    await popup.waitForFunction(() => !(document.getElementById("main-action") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 150_000 });
    card.check("…and enabled once it's written", await attach.isEnabled());
    await Promise.all([popup.close(), page.close()]);
    const untailored = await rig.open(URLS.untailored);
    card.check("never written: the main action is Write now", (await untailored.popup.locator("#main-action").textContent()) === "Write now");
    await Promise.all([untailored.popup.close(), untailored.page.close()]);
  }

  // Dossier stopped between opening and attaching.
  {
    const { popup, page } = await rig.open(URLS.greenhouse);
    rig.outage(true);
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await popup.getByRole("alert").waitFor();
    card.check("Dossier down when attaching: says so, Try again", /Can't reach Dossier/.test((await popup.getByRole("alert").textContent()) ?? "") && (await popup.getByRole("button", { name: "Try again" }).count()) === 1);
    rig.outage(false);
    await popup.getByRole("button", { name: "Try again" }).click();
    await popup.getByRole("button", { name: /^Attach resume/ }).click();
    await attached(popup);
    card.check("…and Try again works once it's back", (await formState(page)).uploads[0].files === 1);
    await Promise.all([popup.close(), page.close()]);
  }

  const posts = rig.refused.filter((request) => request.method !== "GET");
  card.check("no request but GETs ever left for another site (nothing submitted)", posts.length === 0, JSON.stringify(posts.slice(0, 3)));

  await rig.context.close();
  await browser.close();
}

main().then(
  () => process.exit(card.failed ? 1 : 0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);

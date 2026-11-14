// Fork-only. The extension's API end to end against a dev server with an AI
// (the e2e fake AI is enough): save a job with tailoring, wait for the
// resume, download it as the extension would, find the job from its apply
// form, mark it applied. Run: yarn tsx e2e/ext/api-check.ts

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright-core";
import { extractText, getDocumentProxy } from "unpdf";

import { BASE, makeToken, OUT, scorecard, signIn } from "./support";

const card = scorecard();
const stamp = Date.now() % 1_000_000_000;
const POSTING = `https://job-boards.greenhouse.io/acme/jobs/40${stamp}`;
const APPLY_FORM = `https://boards.greenhouse.io/embed/job_app?for=acme&token=40${stamp}`;
const DESCRIPTION = "Acme is hiring a Backend Developer in Toronto. You will build Python and PostgreSQL services, design REST APIs, and work with product designers. Requirements: 3+ years of backend development, Figma familiarity a plus.";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await signIn(page);
  const token = await makeToken(page);
  await browser.close();

  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${BASE}/api/ext${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
    return { status: response.status, response };
  };
  /** What the checks read from the API's answers; any one answer has only some of it. */
  type Answer = {
    application: { id: string; status: string; statusLabel: string; resume: string; letter: string };
    matches: { id: string }[];
    page: { kind: string };
    existing: boolean;
    tailoring: string;
    changed: boolean;
    error?: { code: string; message: string };
  };
  const json = async (path: string, init: RequestInit = {}) => {
    const { status, response } = await api(path, init);
    return { status, body: (await response.json()) as Answer };
  };

  const notSaved = await json(`/applications/lookup?url=${encodeURIComponent(POSTING)}`);
  card.check("lookup before saving: no match, page is a Greenhouse posting", notSaved.status === 200 && notSaved.body.matches.length === 0 && notSaved.body.page.kind === "posting");

  const save = { url: `${POSTING}?gh_src=li`, sourceUrl: `https://www.linkedin.com/jobs/view/39${stamp}/`, title: "Backend Developer", company: "Acme", location: "Toronto, ON", description: DESCRIPTION, tailor: true };
  const saved = await json("/applications", { method: "POST", body: JSON.stringify(save) });
  const id = saved.body.application?.id as string;
  card.check("save with tailoring: 201, Draft, tailoring started", saved.status === 201 && saved.body.application.status === "DRAFT" && saved.body.tailoring === "started", JSON.stringify({ status: saved.status, tailoring: saved.body.tailoring }));

  const again = await json("/applications", { method: "POST", body: JSON.stringify(save) });
  card.check("same job saved again: 200, existing, same application", again.status === 200 && again.body.existing === true && again.body.application.id === id);

  const listPage = await json("/applications", { method: "POST", body: JSON.stringify({ url: "https://jobs.lever.co/acme" }) });
  card.check("list page refused with a clear message", listPage.status === 400 && /lists many jobs/.test(listPage.body.error?.message ?? ""), listPage.body.error?.message);

  const early = await api(`/applications/${id}/resume.pdf`);
  card.check("resume before it's written: 409 not-ready (or already ready)", early.status === 409 || early.status === 200, String(early.status));

  let state = "";
  const started = Date.now();
  while (Date.now() - started < 240_000) {
    const current = await json(`/applications/${id}`);
    state = `${current.body.application.resume}/${current.body.application.letter}`;
    if (!state.includes("writing") && !state.includes("missing")) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  card.check("resume and letter written in the background", state === "ready/ready", `${state} after ${Math.round((Date.now() - started) / 1000)}s`);

  const pdf = await api(`/applications/${id}/resume.pdf`);
  const bytes = new Uint8Array(await pdf.response.arrayBuffer());
  const disposition = pdf.response.headers.get("content-disposition") ?? "";
  writeFileSync(`${OUT}api-resume.pdf`, bytes);
  card.check("resume.pdf: 200, application/pdf, sane size", pdf.status === 200 && pdf.response.headers.get("content-type") === "application/pdf" && bytes.length > 5_000 && bytes.length < 2_000_000, `${bytes.length} bytes`);
  card.check("resume.pdf named with the company", /Acme/i.test(disposition), disposition);
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  card.check("resume.pdf is one page and reads Experience first", doc.numPages === 1 && text.search(/Experience/i) >= 0 && (text.search(/Skills/i) < 0 || text.search(/Experience/i) < text.search(/Skills/i)), `${doc.numPages} page(s)`);
  const letter = await api(`/applications/${id}/cover-letter.pdf`);
  card.check("cover-letter.pdf: 200, application/pdf", letter.status === 200 && letter.response.headers.get("content-type") === "application/pdf");

  const fromForm = await json(`/applications/lookup?url=${encodeURIComponent(APPLY_FORM)}`);
  card.check("lookup from the apply form (embed) finds it", fromForm.body.matches?.[0]?.id === id && fromForm.body.page.kind === "apply-form");
  const fromSource = await json(`/applications/lookup?url=${encodeURIComponent(`https://www.linkedin.com/jobs/search/?currentJobId=39${stamp}`)}`);
  card.check("lookup from the LinkedIn page it was found on finds it", fromSource.body.matches?.[0]?.id === id);

  const applied = await json(`/applications/${id}/applied`, { method: "POST" });
  card.check("mark applied: Draft → Sent", applied.status === 200 && applied.body.changed === true && applied.body.application.statusLabel === "Sent");
  const appliedAgain = await json(`/applications/${id}/applied`, { method: "POST" });
  card.check("mark applied twice: no second change", appliedAgain.body.changed === false);

  const missing = await json("/applications/nope/applied", { method: "POST" });
  card.check("unknown application: 404 with a message", missing.status === 404 && Boolean(missing.body.error?.message));
  const bad = await json("/applications", { method: "POST", body: "{not json" });
  card.check("garbage body: 400", bad.status === 400);

  if (card.failed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

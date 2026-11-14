// The popup (toolbar button, or Alt+Shift+D): what this page is, and the one
// thing to do about it. A job not saved yet: check its details and save it
// (and tailor). A saved job: where its resume and letter are. A list or
// another page: say so.
//
// It reads the page (readPage) and never changes, clicks or submits anything
// on it. On LinkedIn it only reads the job's details; Easy Apply is never
// touched.

import { classify, type Classified } from "../../src/lib/ext/page/classify";
import { attach, describeAttached, scanTab, target, type Uploads } from "./attach";
import { readPage, type PageRead } from "../../src/lib/ext/page/read-page";
import { ApiError, getConfig, json, originPattern, type Config, type ExtApplication, type Lookup, type SaveResult } from "./api";
import { chrome, type Tab } from "./chrome";
import { gear, h, mark } from "./dom";
import type { Message } from "./background";

const root = document.getElementById("app")!;

const ATS_NAMES: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor" };

/** "Greenhouse · application form": what the page is, under the header. */
function describe(classified: Classified): string {
  const name = classified.site ? `${ATS_NAMES[classified.site]} · ` : "";
  return { posting: `${name}Job posting`, form: `${name}Application form`, list: `${name}Job list`, none: "Not a job page" }[classified.kind];
}

function frame(subtitle: string, ...body: (Node | null)[]) {
  root.replaceChildren(
    h("header", { class: "top" }, mark(), h("div", {}, h("p", { class: "brand" }, "Dossier"), h("p", { class: "what", id: "what" }, subtitle)), h("button", { class: "icon", type: "button", "aria-label": "Options", title: "Options", onclick: () => void chrome.runtime.openOptionsPage() }, gear())),
    h("main", {}, ...body),
  );
}

const loading = (subtitle: string, text: string) => frame(subtitle, h("p", { class: "muted", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text));

function showError(subtitle: string, error: unknown, retry: () => void) {
  const known = error instanceof ApiError ? error : new ApiError("unexpected", "Something went wrong. Try again.");
  frame(
    subtitle,
    h("div", { class: "notice error", role: "alert" }, known.message),
    h(
      "div",
      { class: "actions" },
      known.reconnect
        ? h("button", { class: "primary", type: "button", onclick: () => void chrome.runtime.openOptionsPage() }, "Open Options")
        : h("button", { class: "secondary", type: "button", onclick: retry }, "Try again"),
    ),
  );
}

const STATUS_COLORS: Record<string, string> = { DRAFT: "draft", SENT: "sent", SCREENING: "screening", INTERVIEW: "interview", OFFER: "offer", ACCEPTED: "accepted", REJECTED: "rejected", DECLINED: "declined" };

type Ctx = { config: Config; tab: Tab & { id: number }; page: PageRead | null; classified: Classified; uploads: Uploads };

type Notice = { text: string; tone: "success" | "warning" };
/** After attaching: what happened, file by file. */
type AttachedView = { lines: string[]; ok: boolean };

const refreshBadge = (ctx: Ctx) => void chrome.runtime.sendMessage({ type: "refresh", tabId: ctx.tab.id, url: ctx.tab.url ?? ctx.classified.url } satisfies Message).catch(() => {});

async function openInDossier(ctx: Ctx, app: ExtApplication) {
  await chrome.tabs.create({ url: `${ctx.config.server}${app.path}` });
  window.close();
}

const DOC_TEXT = {
  resume: { ready: "Resume ready", writing: "Writing the resume…", failed: "The resume couldn't be written", missing: "No resume yet" },
  letter: { ready: "Cover letter ready", writing: "Writing the cover letter…", failed: "The cover letter couldn't be written", missing: "No cover letter yet" },
} as const;

let polling = 0;

const attachLabel = (letter: boolean) => (letter ? "Attach resume and cover letter" : "Attach resume");

function showSaved(ctx: Ctx, app: ExtApplication, options: { notice?: Notice; attached?: AttachedView } = {}) {
  window.clearTimeout(polling);
  const { notice, attached } = options;
  const subtitle = describe(ctx.classified);
  const where = target(ctx.uploads);
  // A form embedded from another site (Greenhouse in a careers page) is only readable once Chrome allows that site: asked on Attach.
  const embedded = (ctx.page?.embeds ?? []).map((url) => originPattern(new URL(url).origin));
  const formPage = !ctx.uploads.blocked && (where !== null || embedded.length > 0);
  // A form that isn't there yet: it shows after a click, or is the posting's Apply away.
  const lookAgain = !formPage && !ctx.uploads.blocked && (ctx.classified.kind === "form" || (ctx.classified.kind === "posting" && ctx.classified.parsed?.ats !== undefined));
  const letter = where?.letter !== undefined && app.letter === "ready";

  const docs = (["resume", "letter"] as const).map((doc) =>
    h("li", { class: `doc ${app[doc]}` }, h("span", { class: "doc-icon", "aria-hidden": "true" }, app[doc] === "ready" ? "✓" : app[doc] === "writing" ? "" : app[doc] === "failed" ? "!" : "–"), DOC_TEXT[doc][app[doc]]),
  );
  const tailor = async (button: HTMLButtonElement) => {
    busy(button, "Starting…");
    try {
      const answer = await json<{ tailoring: "started" | "no-ai"; application: ExtApplication }>(ctx.config, `/applications/${app.id}/tailor`, { method: "POST" });
      if (answer.tailoring === "no-ai") showSaved(ctx, answer.application, { notice: { text: "Dossier has no AI set up, so it can't write them. Set it up in Dossier's Settings.", tone: "warning" } });
      else showSaved(ctx, answer.application);
    } catch (error) {
      showError(subtitle, error, () => showSaved(ctx, app));
    }
  };
  const doAttach = (button: HTMLButtonElement) => {
    // Asked first, while the click still counts as one: Chrome only asks on a click.
    const allowed = embedded.length ? chrome.permissions.request({ origins: embedded }) : Promise.resolve(true);
    void (async () => {
      busy(button, "Getting the PDF…");
      try {
        if (!(await allowed)) throw new ApiError("no-access", "The form is on another site, embedded in this page. Allow the extension to reach it to attach the resume.");
        ctx.uploads = await scanTab(ctx.tab.id);
        const now = target(ctx.uploads);
        if (!now) throw new ApiError("no-field", "There's no resume upload on this page any more. If it shows after a click, click it, then open the extension again.");
        const result = await attach(ctx.config, ctx.tab.id, app, now, () => (button.textContent = "Still getting the PDF…"));
        showSaved(ctx, app, { attached: describeAttached(result) });
      } catch (error) {
        showError(subtitle, error, () => showSaved(ctx, app));
      }
    })();
  };
  const markApplied = async (button: HTMLButtonElement) => {
    busy(button, "Marking…");
    try {
      const { application } = await json<{ application: ExtApplication; changed: boolean }>(ctx.config, `/applications/${app.id}/applied`, { method: "POST" });
      refreshBadge(ctx);
      showSaved(ctx, application, { notice: { text: `Marked as applied. It's ${application.statusLabel} in Dossier.`, tone: "success" } });
    } catch (error) {
      showError(subtitle, error, () => showSaved(ctx, app, options));
    }
  };
  const click = (fn: (button: HTMLButtonElement) => unknown) => (event: Event) => void fn(event.currentTarget as HTMLButtonElement);
  const button = (label: string, kind: "primary" | "secondary", onclick: EventListener, id?: string, disabled = false) => h("button", { class: kind, type: "button", id, disabled, onclick }, label);
  const open = (kind: "primary" | "secondary") => button("Open in Dossier", kind, () => void openInDossier(ctx, app), kind === "primary" ? "main-action" : undefined);
  const tailorButton = (kind: "primary" | "secondary") => button(app.resume === "missing" ? "Write now" : "Try again", kind, click(tailor), kind === "primary" ? "main-action" : undefined);
  const draft = app.status === "DRAFT";

  // One main action for where things are: attach, then mark applied; else write; else open.
  let actions: Node[];
  let hint: string | null = null;
  if (formPage && attached) {
    actions = draft ? [button("Mark applied", "primary", click(markApplied), "main-action"), button("Attach again", "secondary", click(doAttach))] : [open("primary"), button("Attach again", "secondary", click(doAttach))];
    if (draft) hint = "Check the form and submit it yourself, then mark it applied.";
  } else if (formPage && app.resume === "ready") {
    actions = [button(attachLabel(letter), "primary", click(doAttach), "main-action"), open("secondary")];
    if (where?.letter && app.letter !== "ready") hint = "The form also takes a cover letter, but Dossier doesn't have one ready.";
  } else if (formPage && app.resume === "writing") {
    actions = [button(attachLabel(false), "primary", () => {}, "main-action", true), open("secondary")];
    hint = "Attach is ready once the resume is.";
  } else if (formPage) {
    actions = [tailorButton("primary"), open("secondary")];
  } else {
    actions = [open("primary"), ...(app.resume === "missing" || app.resume === "failed" || app.letter === "failed" ? [tailorButton("secondary")] : [])];
  }
  if (lookAgain)
    hint = ctx.classified.kind === "form" ? "No resume upload on this page yet. If it shows after a click, click it, then look again." : "To attach the resume, open the application form, then look again.";

  frame(
    subtitle,
    notice ? h("div", { class: `notice ${notice.tone}`, role: "status" }, notice.text) : null,
    attached ? h("div", { class: `notice ${attached.ok ? "success" : "warning"}`, role: "status", id: "attached" }, ...attached.lines.map((line) => h("p", {}, line))) : null,
    h(
      "section",
      { class: "card", "aria-label": "Saved application" },
      h("p", { class: "title" }, app.role || app.title),
      app.company ? h("p", { class: "muted" }, app.company) : null,
      h("p", { class: "status" }, h("span", { class: "dot", style: `background: var(--color-status-${STATUS_COLORS[app.status] ?? "draft"})`, "aria-hidden": "true" }), app.statusLabel, app.archived ? " · Archived" : ""),
      h("ul", { class: "docs", "aria-live": "polite" }, ...docs),
    ),
    hint ? h("p", { class: "hint" }, hint) : null,
    h("div", { class: "actions" }, ...actions, lookAgain ? button("Look again", "secondary", click(async (b) => {
      busy(b, "Looking…");
      ctx.uploads = await scanTab(ctx.tab.id);
      showSaved(ctx, app, options);
    })) : null),
  );
  document.getElementById("main-action")?.focus();
  // While they're being written, show when they're done (and then stop saying they're being written).
  if (app.resume === "writing" || app.letter === "writing") {
    polling = window.setTimeout(async () => {
      try {
        const { application } = await json<{ application: ExtApplication }>(ctx.config, `/applications/${app.id}`);
        const done = application.resume !== "writing" && application.letter !== "writing";
        // Done: the card says they're ready, so the notice only says what was saved.
        showSaved(ctx, application, { ...options, notice: done && notice ? { text: notice.text.replace(/ Writing the resume and cover letter\.$/, ""), tone: notice.tone } : notice });
      } catch {
        // Keep what's shown; the next open asks again.
      }
    }, 3000);
  }
}

function busy(button: HTMLButtonElement, label: string) {
  button.disabled = true;
  button.textContent = label;
}

function showPick(ctx: Ctx, matches: ExtApplication[]) {
  frame(
    describe(ctx.classified),
    h("p", {}, "This job is saved more than once. Which one?"),
    h(
      "ul",
      { class: "picker" },
      ...matches.map((app) =>
        h(
          "li",
          {},
          h("button", { class: "row", type: "button", onclick: () => showSaved(ctx, app) }, h("span", { class: "title" }, app.title), h("span", { class: "muted" }, `${app.statusLabel}${app.archived ? " · Archived" : ""}`)),
        ),
      ),
    ),
  );
}

function field(label: string, name: string, value: string, attrs: Record<string, string | boolean> = {}) {
  const id = `field-${name}`;
  return h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, name, value, autocomplete: "off", spellcheck: "false", ...attrs }));
}

async function showNew(ctx: Ctx, options: { forced?: boolean } = {}) {
  const { page, classified } = ctx;
  const { tailor = true } = await chrome.storage.local.get(["tailor"]);
  const form = h(
    "form",
    { class: "save", novalidate: true },
    field("Job title", "title", page?.title ?? ""),
    field("Company", "company", page?.company ?? ""),
    field("Location", "location", page?.location ?? "", { placeholder: "Toronto, ON" }),
    classified.sourceUrl && classified.parsed?.ats && classified.site !== classified.parsed.ats
      ? h("p", { class: "hint" }, `Saves the company's own posting on ${ATS_NAMES[classified.parsed.ats]}, not the ${ATS_NAMES[classified.site ?? ""] ?? "page's"} copy.`)
      : null,
    classified.warning ? h("div", { class: "notice warning" }, classified.warning) : null,
    options.forced ? h("div", { class: "notice warning" }, "This page didn't look like a job posting. Check the details before saving.") : null,
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "tailor", checked: tailor === true }), "Write the resume and cover letter now"),
    h("div", { class: "actions" }, h("button", { class: "primary", type: "submit", id: "save" }, "Save to Dossier")),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save(ctx, form);
  });
  const suggestions = h("div", { id: "suggestions" });
  frame(describe(classified), suggestions, form);
  document.getElementById("save")?.focus();
  if (classified.kind === "form") void suggest(ctx, suggestions);
}

/**
 * On an application form Dossier doesn't know (a Workday form for a job saved
 * from LinkedIn): the saved jobs it may be, to link it to one instead of
 * saving the job twice.
 */
async function suggest(ctx: Ctx, into: HTMLElement) {
  const company = ctx.page?.company ?? "";
  try {
    let { applications } = await json<{ applications: ExtApplication[] }>(ctx.config, `/applications?q=${encodeURIComponent(company)}`);
    if (applications.length === 0 && company) ({ applications } = await json<{ applications: ExtApplication[] }>(ctx.config, "/applications?q="));
    if (applications.length === 0) return;
    const link = async (app: ExtApplication, button: HTMLButtonElement) => {
      busy(button, "Linking…");
      try {
        const { application } = await json<{ application: ExtApplication }>(ctx.config, `/applications/${app.id}/urls`, { method: "POST", body: JSON.stringify({ url: ctx.classified.url }) });
        refreshBadge(ctx);
        showSaved(ctx, application, { notice: { text: "Linked this form to the saved job.", tone: "success" } });
      } catch (error) {
        showError(describe(ctx.classified), error, () => void showNew(ctx));
      }
    };
    into.replaceChildren(
      h(
        "section",
        { class: "suggest", "aria-label": "Saved jobs this may be" },
        h("p", { class: "label" }, "Saved it from another page?"),
        h(
          "ul",
          { class: "picker" },
          ...applications.slice(0, 3).map((app) =>
            h(
              "li",
              {},
              h(
                "button",
                { class: "row", type: "button", onclick: (event: Event) => void link(app, event.currentTarget as HTMLButtonElement) },
                h("span", { class: "title" }, app.title),
                h("span", { class: "muted" }, `${app.statusLabel} · Link this form to it`),
              ),
            ),
          ),
        ),
        h("p", { class: "label" }, "Or save it as a new job:"),
      ),
    );
  } catch {
    // Suggestions are a convenience: saving still works without them.
  }
}

async function save(ctx: Ctx, form: HTMLFormElement) {
  const data = new FormData(form);
  const tailor = data.get("tailor") === "on";
  const button = form.querySelector<HTMLButtonElement>("#save")!;
  button.disabled = true;
  button.textContent = "Saving…";
  await chrome.storage.local.set({ tailor });
  try {
    const result = await json<SaveResult>(ctx.config, "/applications", {
      method: "POST",
      body: JSON.stringify({
        url: ctx.classified.url,
        ...(ctx.classified.sourceUrl ? { sourceUrl: ctx.classified.sourceUrl } : {}),
        title: String(data.get("title") ?? "").trim(),
        company: String(data.get("company") ?? "").trim(),
        location: String(data.get("location") ?? "").trim(),
        // An application form alone doesn't have the job's description: Dossier reads the posting itself.
        description: ctx.classified.parsed?.kind === "apply-form" ? "" : (ctx.page?.description ?? ""),
        tailor,
      }),
    });
    refreshBadge(ctx);
    const notice = result.existing
      ? { text: "This job was already saved.", tone: "success" as const }
      : result.tailoring === "no-ai"
        ? { text: "Saved as a Draft. Dossier has no AI set up, so it can't write the resume yet.", tone: "warning" as const }
        : { text: result.tailoring === "started" ? "Saved as a Draft. Writing the resume and cover letter." : "Saved as a Draft.", tone: "success" as const };
    showSaved(ctx, result.application, { notice });
  } catch (error) {
    if (error instanceof ApiError && !error.reconnect) {
      // Keep what was typed: say what went wrong above the button, and let them try again.
      button.disabled = false;
      button.textContent = "Save to Dossier";
      form.querySelector(".notice.error")?.remove();
      button.parentElement!.before(h("div", { class: "notice error", role: "alert" }, error.message));
      return;
    }
    showError(describe(ctx.classified), error, () => void showNew(ctx));
  }
}

/** The tab the popup is for: the active one, or ?tab= (how the tests open the popup in a tab of its own). */
async function targetTab(): Promise<Tab | undefined> {
  const asked = Number(new URLSearchParams(location.search).get("tab"));
  if (Number.isInteger(asked) && asked > 0) return chrome.tabs.get(asked);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readTab(tabId: number): Promise<PageRead | null> {
  try {
    const [main] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return main?.result ?? null;
  } catch {
    // A page extensions can't read (the Web Store, chrome:// pages, a PDF).
    return null;
  }
}

async function start() {
  loading("", "Reading this page…");
  const config = await getConfig();
  if (!config) {
    frame(
      "Not connected",
      h("p", {}, "Connect the extension to your Dossier to save jobs from any page."),
      h("div", { class: "actions" }, h("button", { class: "primary", type: "button", id: "connect", onclick: () => void chrome.runtime.openOptionsPage() }, "Connect to Dossier")),
    );
    document.getElementById("connect")?.focus();
    return;
  }
  const tab = await targetTab();
  if (tab?.id === undefined || !tab.url) {
    frame("Not a job page", h("p", {}, "Dossier can't read this tab."));
    return;
  }
  const page = await readTab(tab.id);
  const classified = classify(page?.url ?? tab.url, page);
  // The application form's file fields, in every frame: where a saved job's resume goes.
  const uploads: Uploads = classified.kind === "form" || classified.kind === "posting" ? await scanTab(tab.id) : { blocked: false, frames: [] };
  const ctx: Ctx = { config, tab: { ...tab, id: tab.id }, page, classified, uploads };

  if (classified.kind === "list") {
    frame(describe(classified), h("p", {}, "This page lists many jobs. Open one to save it."));
    return;
  }
  if (classified.kind === "none") {
    frame(
      describe(classified),
      h("p", {}, page ? "This page doesn't look like a job posting." : "Dossier can't read this page."),
      page ? h("div", { class: "actions" }, h("button", { class: "secondary", type: "button", onclick: () => void lookup(ctx, true) }, "Save it anyway")) : null,
    );
    return;
  }
  await lookup(ctx, false);
}

async function lookup(ctx: Ctx, forced: boolean) {
  loading(describe(ctx.classified), "Looking for it in Dossier…");
  try {
    const { matches } = await json<Lookup>(ctx.config, `/applications/lookup?url=${encodeURIComponent(ctx.classified.url)}`);
    // Open applications come first: archived ones only matter when there's no open one.
    const open = matches.filter((match) => !match.archived);
    if (matches.length === 0) await showNew(ctx, { forced });
    else if (open.length <= 1) showSaved(ctx, open[0] ?? matches[0]);
    else showPick(ctx, open);
  } catch (error) {
    showError(describe(ctx.classified), error, () => void lookup(ctx, forced));
  }
}

void start();

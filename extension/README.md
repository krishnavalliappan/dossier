# Dossier for Chrome (fork)

Save a job from any page to your Dossier, then attach its tailored resume (and
cover letter) on the job's application form. Chrome (Manifest V3) only.

## Build and load

```sh
node extension/build.mjs            # → extension/dist
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
choose `extension/dist`.

## Connect

1. In Dossier: **Settings → Extension & ATS → Make a token** (all three
   permissions). It's shown once.
2. The extension's Options open when it's installed (or ⚙ in the popup): enter
   Dossier's address and the token, then **Connect**. Chrome asks for access to
   that one address; the extension can reach nothing else on its own.

## Use

- **Alt+Shift+D** (or the toolbar button) opens it on the page you're on.
- The badge says what the page is: **+** a job to save, **✓** saved,
  **⇪** a saved job's application form, **≡** a list of jobs.
- A job not saved yet: check the title, company and location, then **Save to
  Dossier** (Enter). "Write the resume and cover letter now" starts tailoring
  right away; the popup shows when they're ready.
- On LinkedIn, Indeed and Glassdoor it saves the company's own posting when the
  page links to it, else the board's link (and says so).
- On a saved job's application form: **Attach resume** (and cover letter, when
  the form has a field for it). It replaces a file already there (Simplify's,
  say), says what it replaced, then offers **Mark applied**. You submit the
  form yourself.
- An application form Dossier doesn't know yet (a Workday form for a job saved
  from LinkedIn): "Saved it from another page?" lists saved jobs; pick one to
  link the form to it.

## What it never does

- It never submits a form or clicks anything on a page. The only thing it
  changes is the file in a resume or cover letter field, when you press
  Attach; while it does, the form's submit events are held back.
- On LinkedIn it reads the job's details only: it never attaches anything
  there, and Easy Apply is never touched.
- Only job pages at known ATSs and boards are looked up in Dossier (for the
  badge), never ordinary browsing.

## Code

- `src/lib/ext/page/` (in the app, tested there): `readPage` and
  `scanUploads` / `attachFiles`, injected into the page, and `classify`, which
  decides what the page is.
- `src/lib/ext/url.ts`: the job URL rules the server uses too.
- `extension/src/`: the popup, options page, badge and API client.
- Checks: `node extension/build.mjs --test`, then `yarn tsx e2e/ext/save-check.ts`
  and `yarn tsx e2e/ext/attach-check.ts` (need the dev server; see
  `e2e/ext/support.ts`). The attach check runs on simulated ATS forms
  (`e2e/ext/sim/`). `--test` adds access to
  every site for the checks only. Never load that build for use.
- Manual checks in real Chrome: [CHECKLIST.md](CHECKLIST.md).

# Dossier for Chrome (fork)

Save a job from any page to your Dossier, and see where its tailored resume and
cover letter are. Chrome (Manifest V3) only.

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

## What it never does

- It only reads pages. It never types into, clicks or submits anything on them.
- On LinkedIn it reads the job's details only; Easy Apply is never touched.
- Only job pages at known ATSs and boards are looked up in Dossier (for the
  badge), never ordinary browsing.

## Code

- `src/lib/ext/page/` (in the app, tested there): `readPage`, injected into the
  page, and `classify`, which decides what the page is.
- `src/lib/ext/url.ts`: the job URL rules the server uses too.
- `extension/src/`: the popup, options page, badge and API client.
- Checks: `node extension/build.mjs --test && yarn tsx e2e/ext/save-check.ts`
  (needs the dev server; see `e2e/ext/support.ts`). `--test` adds access to
  every site for the checks only. Never load that build for use.
- Manual checks in real Chrome: [CHECKLIST.md](CHECKLIST.md).

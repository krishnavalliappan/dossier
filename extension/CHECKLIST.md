# Manual checklist (real Chrome)

What the Playwright checks (`e2e/ext/save-check.ts`) can't see: the real
popup, the keyboard shortcut, Chrome's permission prompt, signed-in pages.
Use the demo profile. **Never submit an application. Never open Easy Apply.**

## Install and connect

- [ ] Load unpacked `extension/dist`: Options open by themselves.
- [ ] Connect with a token: Chrome asks for access to Dossier's address only.
- [ ] "Connected to Dossier …" names what the token can do.
- [ ] Alt+Shift+D opens the popup; "Change shortcut" opens Chrome's shortcuts page.

## Recognize and save (Step 7)

- [ ] LinkedIn job view (signed in), Apply goes to a company site: header "LinkedIn · Job posting", saves the company's posting, says so.
- [ ] LinkedIn job with Easy Apply only: saves the LinkedIn link with the warning. Easy Apply untouched.
- [ ] LinkedIn search results with a job open (`currentJobId`): that job.
- [ ] Indeed `viewjob`: a job; Indeed search: a list.
- [ ] Greenhouse board: a list. Greenhouse posting: "Application form", details filled.
- [ ] Company careers page with an embedded Greenhouse form: "Greenhouse · Application form".
- [ ] Lever posting, then its /apply: the second finds the job saved from the first.
- [ ] Ashby and Workday postings: details filled.
- [ ] A news article: "Not a job page", Save it anyway works.
- [ ] Save with "Write the resume…" on: the popup shows them being written, then ready.
- [ ] The badge: + before saving, ✓ after, ≡ on lists.
- [ ] Light and dark (system setting): readable, focus rings visible.

## Attach (Step 8): live forms, demo profile, never submit

Only on sites the user approved for a live run (listed and asked first).

- [ ] Greenhouse form with a resume already attached (Simplify): Attach replaces it; the form shows our file name only.
- [ ] Greenhouse cover letter field gets the letter.
- [ ] Greenhouse's own resume parsing / autofill still runs after Attach.
- [ ] Lever /apply: resume attached; Lever's "Analyzing resume" runs.
- [ ] Ashby: resume attached.
- [ ] Workday (after "Apply" → "Apply manually"): one file in the drop zone, not two.
- [ ] Company careers page with an embedded Greenhouse form: Chrome asks for access to Greenhouse once; attached inside the frame.
- [ ] Attach twice: still one file.
- [ ] Mark applied: Sent in Dossier; the reminder to submit yourself is shown first.
- [ ] Nothing was submitted (no confirmation page, no email from the company).

## Failures

- [ ] Dossier stopped: "Can't reach Dossier at …", Try again works once it's back.
- [ ] Token revoked in Dossier: "This token no longer works", Open Options.
- [ ] Chrome Web Store page: "Dossier can't read this page."

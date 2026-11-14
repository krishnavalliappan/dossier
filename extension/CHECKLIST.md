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

## Failures

- [ ] Dossier stopped: "Can't reach Dossier at …", Try again works once it's back.
- [ ] Token revoked in Dossier: "This token no longer works", Open Options.
- [ ] Chrome Web Store page: "Dossier can't read this page."

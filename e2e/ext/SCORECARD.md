# Fork scorecard

Each step loops: build → run it for real → look → fix → repeat. One row per scenario.

## Step 1 · Bullet bank importer (demo bank, `src/lib/ext/bank/fixtures/demo-bank.md`)

| Scenario | Result | Fixed along the way |
|---|---|---|
| One-line entries (`**A1** ✅ · status: APPROVED — text`) | ✅ | |
| Variants by suffix (`D1-N` / `D1-H`) and by sub-item (`N:` / `HC:`) | ✅ | |
| Entry written as a heading with its text below | ✅ | blank line after the heading ended the entry |
| Draft, ⟦N⟧, no text, duplicate id → refused with a reason | ✅ | |
| DO NOT CLAIM phrase inside a bullet → refused | ✅ | trailing "." stopped the match |
| Heading that matches no role → reported, never guessed | ✅ | |
| Re-run → no duplicates, nothing changes | ✅ | |
| Bullet taken back → removed from profile; entry emptied | ✅ | |
| Too thin (3 bullets / 1 per role) → warning | ✅ | |
| CLI dry run, then `--apply` twice on a seeded dev DB | ✅ | |

## Step 2 · Tailoring guard

| Scenario | Result |
|---|---|
| Healthtech posting (2 distinct health terms) → healthcare variants | ✅ |
| "health benefits / dental" alone → stays neutral | ✅ |
| DO NOT CLAIM sentence in summary or bullet → cut, rest kept | ✅ |
| No bank imported → no change at all | ✅ |
| Guard on all writers: new application, missing document, rewrite part, MCP connector | ✅ |

## Step 3 · ATS reading order (`yarn tsx e2e/ext/ats-check.ts`, demo profile, fit to one page)

PDF text extracted with pdf.js (content-stream order, as pdftotext reads it; poppler isn't installed here).

| Theme | Layout | Off | On |
|---|---|---|---|
| editorial | single | ✅ | ✅ |
| classic | single | ✅ | ✅ |
| modern | split | ❌ Skills before Experience; letter-spaced headings | ✅ |
| minimal | single | ❌ letter-spaced headings | ✅ |
| technical | split | ❌ Skills before Experience | ✅ |
| ledger | split | ❌ Skills before Experience | ✅ |
| signal | single | ❌ letter-spaced headings | ✅ |
| studio | split-end | ❌ letter-spaced headings | ✅ |
| chronicle | single | ✅ | ✅ |
| folio | side headings | ✅ | ✅ |
| console | split | ❌ Skills before Experience; letter-spaced headings | ✅ |
| atlas | single | ❌ letter-spaced headings | ✅ |

All: 1 page, no images. Found along the way: CAPS/BAR/BAND headings (`.14em` tracking) come out
as `E X P E R I E N C E`; ATS order now caps section-heading tracking at `.04em`. Rendered pages
(modern, console) compared off/on: same layout, headings slightly tighter.

## Step 4 · URL normalization (`src/lib/ext/url.test.ts`)

| Scenario | Result | Fixed along the way |
|---|---|---|
| Greenhouse: boards/job-boards/EU hosts, `embed/job_app?for&token`, company site `?gh_jid`, board page | ✅ | |
| Lever posting vs `/apply`; Ashby posting vs `/application`; their boards | ✅ | Ashby org names with spaces |
| Workday: locale or not, `/apply/applyManually`, `/details/`, myworkdaysite, site list | ✅ | |
| SmartRecruiters, LinkedIn view/slug/`currentJobId`, Indeed `jk`/`vjk`/`rc/clk`, Glassdoor `jl` | ✅ | |
| Every URL of one job → one key; different jobs/tenants → different keys | ✅ | |
| `mailto:`, `chrome://`, `javascript:`, malformed `%` escapes → null/unknown, never a throw | ✅ | `mailto:` parsed as user@host |

## Step 5 · Tokens (`e2e/ext/tokens-check.ts` on the dev server, plus db tests)

| Scenario | Result | Fixed along the way |
|---|---|---|
| Make a token in Settings: shown once, copy button, listed after reload without the token | ✅ | |
| `/api/ext/ping` with the token → 200 + scopes | ✅ | |
| `/api/ext/*` with only the session cookie → 401 | ✅ | |
| App's `/api/pdf` with the token → 401 (cookie routes unchanged) | ✅ | |
| Revoked token → 401 "make a new one in Settings → Extension & ATS" | ✅ | |
| Password change → token invalid, flagged "no longer valid" in the list | ✅ | |
| Missing scope → 403 with a clear message | ✅ | |
| Light and dark screenshots, existing components only | ✅ | dates used the browser's locale (hydration risk) → app's formatter |

## Step 6: save + lookup API (`feat/ext-api`)

Live run against the dev server with a fake AI (`e2e/ext/api-check.ts`), demo profile.

| Scenario | Result | Fixed along the way |
|---|---|---|
| Lookup before saving: no match, page read as a Greenhouse posting | ✅ | |
| Save with tailoring: 201, Draft, tailoring started | ✅ | |
| Same job saved again (two at once included, db test) → same application | ✅ | P2002 race handled |
| List page refused with a clear message | ✅ | |
| Resume asked for before it's written → 409 not-ready | ✅ | |
| Resume and letter written in the background | ✅ | |
| resume.pdf: 200, application/pdf, sane size, named with the company | ✅ | |
| resume.pdf is one page, Experience first | ✅ | Tailored resumes ran to 2 pages: `/print/resume/:id?fit=n` squeezes a step at a time as Fit to one page does |
| cover-letter.pdf: 200 | ✅ | |
| Lookup from the apply form (Greenhouse embed) and from the LinkedIn page it was found on | ✅ | |
| Mark applied: Draft → Sent, once; one further along left alone | ✅ | Never moves a later status back |
| Job saved again after its application was deleted | ✅ | Orphan links released |
| Unknown application 404, garbage body 400, with messages | ✅ | |

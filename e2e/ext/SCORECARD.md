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

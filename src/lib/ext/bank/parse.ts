// Fork-only: reads a bullet bank (a Markdown file kept outside the repo) into
// bullets, their variants and the DO NOT CLAIM list. Only what passes
// `approvedBullets` may reach the profile. The format it reads:
//
//   ## Software Developer @ Northwind Logistics      ← a role or project heading
//   - **A1** ✅ VERIFIED · status: APPROVED — Built the billing API in Go.
//   - **D1-N** 🟡 STRETCH · status: APPROVED — Neutral wording.
//   - **D1-H** 🟡 STRETCH · status: APPROVED — Healthcare wording.
//   - **B4** ✅ VERIFIED · status: DRAFT
//     - N: Neutral wording, as a sub-item.
//     - HC: Healthcare wording, as a sub-item.
//
//   ## DO NOT CLAIM
//   - "Led a team of ten" — never managed anyone
//
// It is lenient on purpose: ids may be bold, in backticks or bare; the
// status, tier and text may sit on the id's line or on lines under it
// (`status: APPROVED`, `text: …`); a variant is either an id suffix
// (-N neutral, -H/-HC healthcare) or an `N:`/`HC:` sub-item.

export type BankVariant = "neutral" | "healthcare";
export type BankTier = "VERIFIED" | "STRETCH" | "IN_PROGRESS" | "";

export type BankBulletEntry = {
  /** The id with its variant suffix, e.g. "D1-N"; a bare id is the neutral variant. */
  id: string;
  /** The id without the variant suffix, e.g. "D1". */
  baseId: string;
  variant: BankVariant;
  /** The nearest heading above it: the role or project it belongs to. */
  heading: string;
  tier: BankTier;
  /** Upper-cased, e.g. "APPROVED"; empty when the bank doesn't say. */
  status: string;
  text: string;
  /** 1-based line in the file, for messages. */
  line: number;
};

export type BankHeading = { text: string; line: number };

export type ParsedBank = {
  bullets: BankBulletEntry[];
  /** Headings with at least one bullet under them, in file order. */
  headings: BankHeading[];
  /** The DO NOT CLAIM phrases, as written. */
  blocked: string[];
};

export type Rejection = { id: string; line: number; reason: string };

const ID = /^(?:\*\*|`|__)?([A-Z]{1,3}\d{1,3}(?:\.\d+)?)(?:-(N|H|HC|HEALTH|HEALTHCARE))?(?:\*\*|`|__)?(?=[\s:·|—–\-.)\]]|$)/;
const VARIANT_ITEM = /^(N|NEUTRAL|H|HC|HEALTH|HEALTHCARE)\s*[:=]\s*(.+)$/i;
const FIELD = /^(status|tier|text|tags?|source|notes?|evidence|why|lane|lanes)\s*[:=]\s*(.*)$/i;
const STATUS_INLINE = /\bstatus\s*[:=]\s*\**\s*([A-Za-z_-]+)/i;
const PLACEHOLDER = /⟦[^⟧]*⟧/;
const BLOCK_HEADING = /do\s*not\s*claim|never\s*claim/i;

const variantOf = (suffix: string | undefined): BankVariant =>
  suffix && /^(H|HC|HEALTH|HEALTHCARE)$/i.test(suffix) ? "healthcare" : "neutral";

function tierOf(text: string): BankTier {
  if (/✅|\bVERIFIED\b/i.test(text)) return "VERIFIED";
  if (/🟡|\bSTRETCH\b/i.test(text)) return "STRETCH";
  if (/🔵|\bIN[- _]?PROGRESS\b/i.test(text)) return "IN_PROGRESS";
  return "";
}

/** The bullet's own words from its first line, without the id, tier, status and separators. */
function textAfterMeta(rest: string): string {
  return rest
    .replace(STATUS_INLINE, "")
    .replace(/✅|🟡|🔵/g, "")
    .replace(/\b(VERIFIED|STRETCH|IN[- _]?PROGRESS)\b/gi, "")
    .replace(/^[\s:·|—–\-.)\]]+/, "")
    .replace(/^(?:[\s·|]+)/, "")
    .replace(/^[—–:-]\s*/, "")
    .trim();
}

/** Markdown emphasis and quotes off, spaces collapsed. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](?=\s|$|[.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The phrase a DO NOT CLAIM item forbids: the quoted part, or the part before a dash explanation. */
function blockedPhrase(item: string): string {
  const quoted = /["“]([^"”]+)["”]/.exec(item)?.[1];
  const phrase = quoted ?? item.split(/\s+[—–]\s+|\s+-\s+|\s*\(/)[0];
  return plainText(phrase).replace(/[.;,]+$/, "");
}

type Line = { indent: number; item: boolean; body: string; heading: number; no: number };

function lex(markdown: string): Line[] {
  return markdown.split(/\r?\n/).map((raw, index) => {
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const heading = /^(#{1,6})\s+/.exec(trimmed)?.[1].length ?? 0;
    const item = !heading && /^([-*+]|\d+[.)])\s+/.test(trimmed);
    const body = heading ? trimmed.replace(/^#{1,6}\s+/, "") : item ? trimmed.replace(/^([-*+]|\d+[.)])\s+/, "") : trimmed;
    return { indent, item, body: body.trim(), heading, no: index + 1 };
  });
}

/** Reads a bullet bank. Never throws: what it can't read is left out (and so never approved). */
export function parseBank(markdown: string): ParsedBank {
  const lines = lex(markdown);
  const bullets: BankBulletEntry[] = [];
  const blocked: string[] = [];
  const headings: BankHeading[] = [];
  let heading: BankHeading = { text: "", line: 0 };
  let blockLevel = 0; // inside DO NOT CLAIM while > 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.heading) {
      if (blockLevel && line.heading <= blockLevel) blockLevel = 0;
      if (BLOCK_HEADING.test(line.body)) {
        blockLevel = line.heading;
        continue;
      }
      if (!blockLevel && !ID.test(line.body)) {
        heading = { text: plainText(line.body), line: line.no };
        continue;
      }
    }
    if (blockLevel) {
      if (line.item && line.body) {
        const phrase = blockedPhrase(line.body);
        if (phrase) blocked.push(phrase);
      }
      continue;
    }

    const match = (line.item || line.heading) && ID.exec(line.body);
    if (!match) continue;
    const [whole, baseId, suffix] = match;
    const rest = line.body.slice(whole.length);

    // The entry's own lines: everything more indented (or plain text) until the next item at its level, heading or blank gap.
    const children: Line[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.heading) break;
      if (!next.body) {
        if (line.heading) continue;
        if (j + 1 < lines.length && lines[j + 1].indent > line.indent && !lines[j + 1].heading) continue;
        break;
      }
      if (next.item && next.indent <= line.indent && !line.heading) break;
      if (next.item && line.heading && ID.test(next.body)) break;
      children.push(next);
      i = j;
    }

    let status = STATUS_INLINE.exec(rest)?.[1] ?? "";
    let tier = tierOf(rest);
    let text = textAfterMeta(rest);
    const variants: { variant: BankVariant; text: string; line: number }[] = [];
    for (const child of children) {
      const field = FIELD.exec(child.body);
      const variant = VARIANT_ITEM.exec(child.body);
      if (field) {
        const [, key, value] = field;
        if (/^status$/i.test(key)) status = value.replace(/[*_`]/g, "").trim().split(/\s/)[0] ?? "";
        else if (/^tier$/i.test(key)) tier = tierOf(value) || tier;
        else if (/^text$/i.test(key)) text = value;
      } else if (variant) {
        variants.push({ variant: /^(N|NEUTRAL)$/i.test(variant[1]) ? "neutral" : "healthcare", text: variant[2], line: child.no });
      } else if (!text && !child.item) {
        text = child.body.replace(/^>\s*/, "");
      } else if (!child.item && child.body.startsWith(">")) {
        text = child.body.replace(/^>\s*/, "");
      }
    }
    status = status.toUpperCase().replace(/-/g, "_");
    tier = tier || tierOf(children.map((child) => child.body).join(" "));

    if (!headings.some((known) => known.line === heading.line)) headings.push(heading);
    const base = { baseId, heading: heading.text, tier, status };
    if (variants.length) {
      for (const variant of variants) {
        const id = variant.variant === "healthcare" ? `${baseId}-H` : `${baseId}-N`;
        bullets.push({ ...base, id, variant: variant.variant, text: plainText(variant.text), line: variant.line });
      }
    } else {
      const variant = variantOf(suffix);
      const id = suffix ? `${baseId}-${variant === "healthcare" ? "H" : "N"}` : baseId;
      bullets.push({ ...base, id, variant, text: plainText(text), line: line.no });
    }
  }
  return { bullets, headings, blocked };
}

/** Lower case, plain words: how claims are compared. */
export const claimKey = (text: string) =>
  plainText(text)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\.(?!\d)/g, " ")
    .replace(/[^\p{L}\p{N}%+$'.]+/gu, " ")
    .trim();

/** The DO NOT CLAIM phrase `text` contains, if any. */
export function blockedIn(text: string, blocked: readonly string[]): string | undefined {
  const key = ` ${claimKey(text)} `;
  return blocked.find((phrase) => {
    const needle = claimKey(phrase);
    return needle.length > 0 && key.includes(` ${needle} `);
  });
}

/**
 * The bullets that may reach the profile: APPROVED, with no ⟦N⟧ still to
 * fill, with words of their own, not on the DO NOT CLAIM list, and not a
 * second copy of an id. Everything else comes back as a rejection.
 */
export function approvedBullets(bank: ParsedBank): { approved: BankBulletEntry[]; rejected: Rejection[] } {
  const approved: BankBulletEntry[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();
  for (const bullet of bank.bullets) {
    const reject = (reason: string) => rejected.push({ id: bullet.id, line: bullet.line, reason });
    const blocked = blockedIn(bullet.text, bank.blocked);
    if (seen.has(bullet.id)) reject("its id is used twice; the first one is kept");
    else if (bullet.status !== "APPROVED") reject(bullet.status ? `status is ${bullet.status}` : "it has no status");
    else if (PLACEHOLDER.test(bullet.text)) reject("it still has a ⟦N⟧ to fill");
    else if (!bullet.text) reject("it has no text");
    else if (blocked) reject(`it says "${blocked}", which is on the DO NOT CLAIM list`);
    else approved.push(bullet);
    seen.add(bullet.id);
  }
  return { approved, rejected };
}

// Fork-only: what the page the extension is on is, from its URL and what the
// page says (readPage). Pure, so it's tested here and bundled into the
// extension. The extension then looks the job up in Dossier: a saved job's
// application form is where its resume gets attached.

import { parseJobUrl, type JobUrl } from "../url";
import type { PageRead } from "./read-page";

export type PageKind =
  /** One job: save it. */
  | "posting"
  /** One job's application form (it may also be the posting, as Greenhouse's are). */
  | "form"
  /** A board, a search or a careers page with many jobs. */
  | "list"
  /** Nothing here says it's a job. */
  | "none";

export type Classified = {
  kind: PageKind;
  /** What to save, and look up: the company's own posting when the page links to it. */
  url: string;
  /** The page the job was found on, when that's not what's saved (a LinkedIn view that links to Greenhouse). */
  sourceUrl?: string;
  /** What the saved URL is: the ATS, aggregator and key. Null when it isn't a web address. */
  parsed: JobUrl | null;
  /** The site the page is on, or the ATS whose form it embeds: what the popup names. */
  site?: string;
  /** Said under the details, when what's saved isn't ideal. */
  warning?: string;
};

const AGGREGATOR = { linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor" } as const;

/** The first of `urls` that is one job at an ATS (not an aggregator, not a list). */
function firstAtsJob(urls: string[]): JobUrl | null {
  for (const url of urls) {
    const parsed = parseJobUrl(url);
    if (parsed?.ats && (parsed.kind === "posting" || parsed.kind === "apply-form")) return parsed;
  }
  return null;
}

const JOB_WORDS = [/responsibilit/i, /qualifications/i, /requirements/i, /what you('|’)ll do/i, /about the (role|job|position)/i, /years of (professional )?experience/i, /\b(salary|compensation|pay range)\b/i, /\bbenefits\b/i];

/**
 * Whether a page that isn't a known ATS still reads as one job: its own
 * posting data; or an Apply button or an upload, over a description that
 * talks like a job ad (an article about resumes has the words, not the button).
 */
const looksLikeJob = (read: PageRead) =>
  read.postings === 1 || (read.title.length > 0 && (read.applyControls > 0 || read.uploads > 0) && read.description.length >= 400 && JOB_WORDS.filter((word) => word.test(read.description)).length >= 2);

export function classify(pageUrl: string, read: PageRead | null): Classified {
  const parsed = parseJobUrl(pageUrl);
  if (!parsed) return { kind: "none", url: pageUrl, parsed: null };
  const site = parsed.ats ?? parsed.aggregator;
  if (parsed.kind === "list" || (read && read.postings > 1)) return { kind: "list", url: parsed.canonical, parsed, site };

  // An aggregator: the company's own posting when the page links to it, else the aggregator's.
  if (parsed.aggregator) {
    const company = read ? firstAtsJob(read.applyLinks) : null;
    if (company) return { kind: "posting", url: company.canonical, sourceUrl: parsed.canonical, parsed: company, site };
    return {
      kind: "posting",
      url: parsed.canonical,
      parsed,
      site,
      warning: `Couldn't find the company's own link, so this saves the ${AGGREGATOR[parsed.aggregator]} one. Open the company's application later and the extension links it.`,
    };
  }

  if (parsed.ats) return { kind: parsed.kind === "apply-form" || (read?.uploads ?? 0) > 0 ? "form" : "posting", url: parsed.canonical, parsed, site };

  // A company's own careers page: an embedded ATS form, else the ATS its canonical link names, else what the page says.
  const embedded = read ? firstAtsJob(read.embeds) : null;
  if (embedded) return { kind: "form", url: embedded.canonical, sourceUrl: parsed.canonical, parsed: embedded, site: embedded.ats };
  const canonical = read?.canonical ? firstAtsJob([read.canonical]) : null;
  if (canonical) return { kind: read && read.uploads > 0 ? "form" : "posting", url: canonical.canonical, parsed: canonical };
  if (read && looksLikeJob(read)) return { kind: read.uploads > 0 ? "form" : "posting", url: parsed.canonical, parsed };
  return { kind: "none", url: parsed.canonical, parsed };
}

/** The toolbar badge for a page known only by its URL (before the page is read): a job or a list, or nothing yet. */
export function classifyUrl(pageUrl: string): PageKind {
  const parsed = parseJobUrl(pageUrl);
  if (!parsed || parsed.kind === "unknown") return "none";
  if (parsed.kind === "list") return "list";
  return parsed.kind === "apply-form" ? "form" : "posting";
}

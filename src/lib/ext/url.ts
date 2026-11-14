// Fork-only: what a job URL is, and the key two URLs of the same job share.
// Used by the extension's save, the lookup on an application form, and the
// dedupe of saved applications, so a posting and its apply form, a
// Greenhouse embed on a company's site and the board page all match.
//
// Pure (only the URL API), so the browser extension bundles it too. Ported
// from job-hunter's canonicalUrl/detectAts/jobIdFromUrl.

export type Ats = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters";
export type Aggregator = "linkedin" | "indeed" | "glassdoor";

/**
 * - posting: one job's page (it may have the application form on it too, as Greenhouse's do);
 * - apply-form: a page that is only the application form of one job;
 * - list: a board, a search or a careers page with many jobs;
 * - unknown: none of the ATSs or aggregators known here.
 */
export type JobUrlKind = "posting" | "apply-form" | "list" | "unknown";

export type JobUrl = {
  kind: JobUrlKind;
  /** The job's address in its clearest form: tracking parameters and apply suffixes off. */
  canonical: string;
  /** What two URLs of the same job share, e.g. "greenhouse:4012345"; the canonical URL for unknown sites. Empty for a list. */
  key: string;
  ats?: Ats;
  aggregator?: Aggregator;
  /** The ATS board or company, when the URL says. */
  board?: string;
  jobId?: string;
};

const TRACKING = /^(utm_[a-z_]+|gh_src|gh_jid_src|lever-source|lever-origin|lever-via|refid|trackingid|ref|source|src|trk|trkinfo|ashby_jid_src|ashby_source|_ga|_gl|gclid|fbclid|mc_[a-z]+|share_id|sharetoken|from|jobsource|codes|iis|iisn|mode|urlhash)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;
const DIGITS = /^\d{4,}$/;
const token = (value: string | null | undefined) => (value && /^[A-Za-z0-9._-]{1,100}$/.test(value) ? value : undefined);

function parse(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    // "mailto:…" or "chrome://…" has a scheme of its own; "careers.acme.com:8080/x" and "acme.com/jobs" don't.
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Host lower-cased without "www.", path without a trailing slash, tracking parameters off, the rest sorted; no fragment. */
export function cleanUrl(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  const params = [...url.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `https://${host}${path}${query}`;
}

const job = (kind: JobUrlKind, canonical: string, key: string, rest: Omit<JobUrl, "kind" | "canonical" | "key">): JobUrl => ({ kind, canonical, key, ...rest });

function greenhouse(url: URL, host: string, seg: string[]): JobUrl | undefined {
  const gh = url.searchParams.get("gh_jid") ?? url.searchParams.get("token");
  const isBoardHost = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host);
  if (!isBoardHost) {
    // A company's own careers page with the Greenhouse embed: ?gh_jid=123.
    const id = url.searchParams.get("gh_jid");
    return id && DIGITS.test(id) ? job("posting", `https://job-boards.greenhouse.io/jobs/${id}`, `greenhouse:${id}`, { ats: "greenhouse", jobId: id }) : undefined;
  }
  if (seg[0] === "embed") {
    const board = token(url.searchParams.get("for"))?.toLowerCase();
    if (gh && DIGITS.test(gh)) {
      const canonical = board ? `https://job-boards.greenhouse.io/${board}/jobs/${gh}` : `https://job-boards.greenhouse.io/jobs/${gh}`;
      return job(seg[1] === "job_app" ? "apply-form" : "posting", canonical, `greenhouse:${gh}`, { ats: "greenhouse", board, jobId: gh });
    }
    return board ? job("list", `https://job-boards.greenhouse.io/${board}`, "", { ats: "greenhouse", board }) : undefined;
  }
  const board = token(seg[0])?.toLowerCase();
  const at = seg.indexOf("jobs");
  const id = at >= 0 ? seg[at + 1] : gh ?? undefined;
  if (id && DIGITS.test(id)) {
    return job("posting", `https://job-boards.greenhouse.io/${board ?? "jobs"}${board ? "/jobs" : ""}/${id}`, `greenhouse:${id}`, { ats: "greenhouse", board, jobId: id });
  }
  return board ? job("list", `https://job-boards.greenhouse.io/${board}`, "", { ats: "greenhouse", board }) : undefined;
}

function lever(host: string, seg: string[]): JobUrl | undefined {
  const board = token(seg[0])?.toLowerCase();
  if (!board) return undefined;
  const base = `https://${host}/${board}`;
  if (seg[1] && UUID.test(seg[1])) {
    const id = seg[1].toLowerCase();
    return job(seg[2] === "apply" ? "apply-form" : "posting", `${base}/${id}`, `lever:${id}`, { ats: "lever", board, jobId: id });
  }
  return job("list", base, "", { ats: "lever", board });
}

function ashby(seg: string[]): JobUrl | undefined {
  let name = "";
  try {
    name = decodeURIComponent(seg[0] ?? "");
  } catch {
    return undefined; // a malformed escape: not a board name
  }
  const board = /^[\w .-]{1,100}$/.test(name) ? name : undefined;
  if (!board) return undefined;
  const base = `https://jobs.ashbyhq.com/${seg[0]}`;
  if (seg[1] && UUID.test(seg[1])) {
    const id = seg[1].toLowerCase();
    return job(seg[2] === "application" ? "apply-form" : "posting", `${base}/${id}`, `ashby:${id}`, { ats: "ashby", board, jobId: id });
  }
  return job("list", base, "", { ats: "ashby", board });
}

function workday(host: string, seg: string[]): JobUrl | undefined {
  // {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/{location}/{Title}_{REQ}[/apply[/...]]
  // wdN.myworkdaysite.com/[locale/]recruiting/{tenant}/{site}/job/...
  const rest = seg[0] && LOCALE.test(seg[0]) ? seg.slice(1) : seg;
  const site = host.endsWith("myworkdaysite.com") ? (rest[0] === "recruiting" ? rest.slice(1, 3) : []) : rest.slice(0, 1);
  const tenant = host.endsWith("myworkdaysite.com") ? site[0] : host.split(".")[0];
  const siteName = host.endsWith("myworkdaysite.com") ? site[1] : site[0];
  if (!token(tenant) || !token(siteName)) return undefined;
  const sitePath = host.endsWith("myworkdaysite.com") ? `recruiting/${tenant}/${siteName}` : siteName;
  const after = rest.slice(host.endsWith("myworkdaysite.com") ? 3 : 1);
  const at = after.findIndex((part) => part === "job" || part === "details");
  const board = `${tenant}/${siteName}`.toLowerCase();
  if (at >= 0) {
    // The req id is after the last underscore of the title segment: Software-Engineer_R260012012.
    const titleIndex = after.findIndex((part, index) => index > at && /_[A-Za-z0-9-]+$/.test(part));
    const title = titleIndex >= 0 ? after[titleIndex] : undefined;
    const req = title && /_([A-Za-z0-9-]+)$/.exec(title)?.[1];
    if (req) {
      const canonical = `https://${host}/${sitePath}/${after.slice(0, titleIndex + 1).join("/")}`;
      const applying = after.slice(titleIndex + 1).some((part) => /^apply/i.test(part));
      return job(applying ? "apply-form" : "posting", canonical, `workday:${tenant.toLowerCase()}:${req.toUpperCase()}`, { ats: "workday", board, jobId: req });
    }
  }
  return job("list", `https://${host}/${sitePath}`, "", { ats: "workday", board });
}

function smartrecruiters(host: string, seg: string[]): JobUrl | undefined {
  // jobs.smartrecruiters.com/{Company}/{id}-{slug}; careers.smartrecruiters.com/{Company} lists.
  const company = token(seg[0]);
  if (!company) return undefined;
  const id = host === "jobs.smartrecruiters.com" ? /^(\d{6,})(?:-|$)/.exec(seg[1] ?? "")?.[1] : undefined;
  if (id) return job("posting", `https://jobs.smartrecruiters.com/${company}/${id}`, `smartrecruiters:${id}`, { ats: "smartrecruiters", board: company.toLowerCase(), jobId: id });
  return job("list", `https://${host}/${company}`, "", { ats: "smartrecruiters", board: company.toLowerCase() });
}

function linkedin(url: URL, seg: string[]): JobUrl | undefined {
  // /jobs/view/<id> or /jobs/view/<title>-at-<company>-<id>; searches and collections carry ?currentJobId=<id>.
  const viewed = seg[0] === "jobs" && seg[1] === "view" ? /(?:^|-)(\d{6,})$/.exec(seg[2] ?? "")?.[1] : undefined;
  const id = viewed ?? url.searchParams.get("currentJobId") ?? undefined;
  if (id && /^\d{6,}$/.test(id)) return job("posting", `https://linkedin.com/jobs/view/${id}`, `linkedin:${id}`, { aggregator: "linkedin", jobId: id });
  if (seg[0] === "jobs") return job("list", cleanUrl(url), "", { aggregator: "linkedin" });
  return undefined;
}

function indeed(url: URL, host: string, seg: string[]): JobUrl | undefined {
  const id = url.searchParams.get("jk") ?? url.searchParams.get("vjk");
  if (id && /^[0-9a-f]{16}$/i.test(id)) return job("posting", `https://${host}/viewjob?jk=${id.toLowerCase()}`, `indeed:${id.toLowerCase()}`, { aggregator: "indeed", jobId: id.toLowerCase() });
  if (seg[0] === "jobs" || seg[0] === "q" || seg[0] === "cmp" || /-jobs/.test(seg[0] ?? "")) return job("list", cleanUrl(url), "", { aggregator: "indeed" });
  return undefined;
}

function glassdoor(url: URL, seg: string[]): JobUrl | undefined {
  const id = url.searchParams.get("jl") ?? url.searchParams.get("jobListingId");
  if (id && /^\d{6,}$/.test(id)) return job("posting", `https://glassdoor.com/job-listing/?jl=${id}`, `glassdoor:${id}`, { aggregator: "glassdoor", jobId: id });
  if (seg[0] === "Job" || seg[0] === "Jobs") return job("list", cleanUrl(url), "", { aggregator: "glassdoor" });
  return undefined;
}

/** What `raw` is, as a job URL; null when it isn't an http(s) URL at all. */
export function parseJobUrl(raw: string): JobUrl | null {
  const url = parse(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const seg = url.pathname.split("/").filter(Boolean);
  const found =
    (/greenhouse\.io$/.test(host) || url.searchParams.has("gh_jid") ? greenhouse(url, host, seg) : undefined) ??
    (host === "jobs.lever.co" || host === "jobs.eu.lever.co" ? lever(host, seg) : undefined) ??
    (host === "jobs.ashbyhq.com" ? ashby(seg) : undefined) ??
    (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host) || /^wd\d+\.myworkdaysite\.com$/.test(host) ? workday(host, seg) : undefined) ??
    (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com" ? smartrecruiters(host, seg) : undefined) ??
    (/(^|\.)linkedin\.com$/.test(host) ? linkedin(url, seg) : undefined) ??
    (/(^|\.)indeed\.[a-z.]+$/.test(host) ? indeed(url, host, seg) : undefined) ??
    (/(^|\.)glassdoor\.[a-z.]+$/.test(host) ? glassdoor(url, seg) : undefined);
  if (found) return found;
  const canonical = cleanUrl(url);
  return { kind: "unknown", canonical, key: canonical };
}

/** The dedupe key of a job URL: the same for every URL of one job. Empty for lists and non-URLs. */
export function jobKey(raw: string): string {
  return parseJobUrl(raw)?.key ?? "";
}

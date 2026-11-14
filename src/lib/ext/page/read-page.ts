// Fork-only: what a job's page says, read inside the page by the browser
// extension (chrome.scripting.executeScript). Only this function's source is
// injected, so it is self-contained: no imports, nothing from outside it.
// Ported from job-hunter's readPosting, plus what recognizing a page needs:
// how many postings it has, the links to the company's own application, and
// ATS application forms embedded in it.
//
// It only reads. It never clicks, types or submits anything.

export type PageRead = {
  url: string;
  title: string;
  company: string;
  location: string;
  /** The job's description: the posting's own data, else the page's description block, else its main text. */
  description: string;
  /** How many schema.org JobPostings the page declares: more than one is a list. */
  postings: number;
  /** <link rel=canonical>, when the page names one. */
  canonical: string;
  /** Where the page's "Apply" links go: an aggregator's link to the company's own application. */
  applyLinks: string[];
  /** ATS application forms embedded in the page (a Greenhouse iframe on a company's careers site). */
  embeds: string[];
  /** File uploads on the page (an application form's resume field). */
  uploads: number;
  /** Buttons and links that say Apply: a job's page has one, an article doesn't. */
  applyControls: number;
};

export function readPage(): PageRead {
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
  const decode = (t: string) =>
    t.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const k = entity.toLowerCase();
      if (k[0] === "#") {
        const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[k] ?? "";
    });
  // JSON-LD text is often HTML-escaped ("Artist &amp; Label"); page text and meta content are already decoded.
  const ldText = (s: unknown) => clean(typeof s === "string" ? decode(s) : s);
  const htmlText = (s: unknown) => {
    if (typeof s !== "string") return "";
    // Some sites escape the HTML once more inside the JSON.
    const html = !/<[a-z]/i.test(s) && /&lt;[a-z]/i.test(s) ? decode(s) : s;
    const text = html
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/ul|\/ol)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return decode(text).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };
  const textOf = (el: Element | null) => ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  type Node = Record<string, unknown>;
  const isPosting = (n: Node) => ([] as unknown[]).concat(n["@type"] ?? []).includes("JobPosting");
  const postings: Node[] = [];
  const collect = (n: unknown, depth: number) => {
    if (!n || typeof n !== "object" || depth > 4) return;
    if (Array.isArray(n)) return n.forEach((x) => collect(x, depth + 1));
    if (isPosting(n as Node)) postings.push(n as Node);
    else collect((n as Node)["@graph"] ?? (n as Node).itemListElement, depth + 1);
    // An ItemList of postings: each list item's `item`.
    if ((n as Node).item) collect((n as Node).item, depth + 1);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collect(JSON.parse(script.textContent ?? ""), 0);
    } catch {
      // Not JSON: some sites ship broken JSON-LD.
    }
  }
  const ld = postings[0];
  const meta = (p: string) => clean(document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content"));
  const org = ld?.hiringOrganization as Node | string | undefined;
  const places = ([] as unknown[]).concat(ld?.jobLocation ?? []).map((place) => {
    const address = ((place && typeof place === "object" && (place as Node).address) || {}) as Node;
    const country = typeof address.addressCountry === "string" ? address.addressCountry : (address.addressCountry as Node | undefined)?.name;
    return [address.addressLocality, address.addressRegion, country].map(ldText).filter(Boolean).join(", ");
  });
  const remote = ([] as unknown[]).concat(ld?.jobLocationType ?? []).includes("TELECOMMUTE");
  const where = [...new Set(places.filter(Boolean))].slice(0, 3).join(" · ");

  /** The text of the first selector that matches, in the order given (not the page's order). */
  const first = (selectors: string[], min = 1) => {
    for (const selector of selectors) {
      const text = textOf(document.querySelector(selector));
      if (text.length >= min) return text;
    }
    return "";
  };
  // The boards' own description blocks, before the whole page's text.
  const fromLd = htmlText(ld?.description);
  const description =
    (fromLd.length >= 200 ? fromLd : "") ||
    first(
      [
        "#jobDescriptionText", // Indeed
        ".show-more-less-html__markup", ".jobs-description__content", ".description__text", // LinkedIn
        "[data-automation-id='jobPostingDescription']", // Workday
        "[data-qa='job-description']", ".posting-page .section-wrapper.page-full-width", // Lever
        ".job__description", "#content .job-post-content", // Greenhouse
        "[class*='_descriptionText']", // Ashby
        "[itemprop='description']",
      ],
      200,
    ) ||
    textOf(document.querySelector("main") ?? document.body);

  // "Backend Developer at Acme", "Acme - Backend Developer", "Backend Developer @ Acme": the tab title names both on most boards.
  const tab = clean(document.title).replace(/\s*[|–—]\s*(LinkedIn|Indeed|Glassdoor)\b.*$/i, "");
  const atCompany = /^(?:job application for )?(.+?) (?:at|@) (.+?)(?: [—–-] .*)?$/i.exec(tab);
  const dashed = /^(.+?) - (.+)$/.exec(tab); // Lever: "Company - Title"
  const fromTab = atCompany ? [atCompany[1], atCompany[2]] : dashed ? [dashed[2], dashed[1]] : undefined;
  const company =
    ldText(typeof org === "string" ? org : org?.name) ||
    clean(first([".topcard__org-name-link", ".job-details-jobs-unified-top-card__company-name", "[data-testid='inlineHeader-companyName']", "[data-company-name]"])) ||
    clean(fromTab?.[1]) ||
    meta("og:site_name");
  const place = clean(
    first([
      ".job__location", // Greenhouse
      ".posting-categories .location", // Lever
      "[data-automation-id='locations'] dd", // Workday
      ".topcard__flavor--bullet", ".job-details-jobs-unified-top-card__primary-description-container .tvm__text", // LinkedIn
      "[data-testid='inlineHeader-companyLocation']", "#jobLocationText", // Indeed
    ]),
  );

  // An aggregator's "Apply on company site": the link itself, or the address it forwards to (LinkedIn's ?url=).
  const applyLinks: string[] = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (applyLinks.length >= 10) break;
    const label = clean(`${a.textContent ?? ""} ${a.getAttribute("aria-label") ?? ""} ${a.className}`);
    if (!/\bapply\b/i.test(label)) continue;
    try {
      const href = new URL(a.href, location.href);
      const forwarded = href.searchParams.get("url");
      const target = forwarded && /^https?:\/\//i.test(forwarded) ? forwarded : href.href;
      if (/^https?:/i.test(target) && !applyLinks.includes(target)) applyLinks.push(target);
    } catch {
      // Not a web address.
    }
  }
  const embeds = [...document.querySelectorAll<HTMLIFrameElement>("iframe[src]")]
    .map((frame) => frame.src)
    .filter((src) => /greenhouse\.io\/embed\/job_app|jobs\.lever\.co|jobs\.ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com/i.test(src))
    .slice(0, 5);

  return {
    url: location.href,
    title: ldText(ld?.title) || clean(document.querySelector("h1")?.textContent) || clean(document.querySelector(".posting-headline h2")?.textContent) || clean(fromTab?.[0]) || meta("og:title") || clean(document.title),
    company,
    location: remote ? (where ? `${where} (remote)` : "Remote") : where || place,
    description: description.slice(0, 60_000),
    postings: postings.length,
    canonical: document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href ?? "",
    applyLinks,
    embeds,
    uploads: document.querySelectorAll("input[type='file']").length,
    applyControls: [...document.querySelectorAll("a, button, input[type='submit']")].filter((el) => /^\s*(apply|submit (your )?application)\b/i.test(clean(el.textContent) || (el as HTMLInputElement).value || "")).length,
  };
}

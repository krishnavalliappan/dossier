// Fork-only: trims a saved public job page into a committed test fixture.
// Keeps the markup the extension reads (headings, the description, links,
// forms, JSON-LD) and drops everything else: scripts, styles, images, hidden
// inputs (form tokens), tracking parameters and most attributes.
//
//   yarn tsx e2e/ext/trim-fixture.ts <saved.html> <page URL> <out.html>

import { readFileSync, writeFileSync } from "node:fs";

import { JSDOM } from "jsdom";

const [input, pageUrl, output] = process.argv.slice(2);
if (!input || !pageUrl || !output) throw new Error("Usage: trim-fixture.ts <saved.html> <page URL> <out.html>");

const dom = new JSDOM(readFileSync(input, "utf8"), { url: pageUrl });
const { document } = dom.window;

const KEEP = new Set(["id", "class", "href", "src", "type", "name", "rel", "content", "property", "for", "role", "data-automation-id", "data-qa", "itemprop", "accept", "multiple", "required", "placeholder", "value", "lang"]);
const TRACKING = /^(utm_|trk|ref|refid|tracking|lipi|gh_src|lever-|source$|src$|_ga|fbclid|gclid)/i;

for (const el of document.querySelectorAll("script:not([type='application/ld+json']), style, noscript, svg, img, picture, video, link:not([rel='canonical']), template, input[type='hidden'], meta:not([property^='og:']):not([name='description']):not([charset])")) el.remove();
for (const frame of document.querySelectorAll("iframe")) {
  if (!/greenhouse|lever|ashby|workday|smartrecruiters/i.test(frame.getAttribute("src") ?? "")) frame.remove();
}
const walker = document.createTreeWalker(document, dom.window.NodeFilter.SHOW_COMMENT);
const comments: Node[] = [];
while (walker.nextNode()) comments.push(walker.currentNode);
comments.forEach((comment) => comment.parentNode?.removeChild(comment));

for (const el of document.querySelectorAll("*")) {
  for (const { name } of [...el.attributes]) if (!KEEP.has(name) && !name.startsWith("aria-")) el.removeAttribute(name);
  // Class lists: the first several names, enough for the selectors.
  const classes = el.getAttribute("class");
  if (classes) el.setAttribute("class", classes.split(/\s+/).filter(Boolean).slice(0, 8).join(" "));
  for (const attribute of ["href", "src"]) {
    const value = el.getAttribute(attribute);
    if (!value || !/^https?:|^\//.test(value)) continue;
    try {
      const url = new URL(value, pageUrl);
      for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
      el.setAttribute(attribute, url.href);
    } catch {
      el.removeAttribute(attribute);
    }
  }
}
// Long runs (a country list, a board's hundred jobs, an article's sections): the first few are enough to recognize the page.
for (const select of document.querySelectorAll("select")) [...select.options].slice(6).forEach((option) => option.remove());
for (const el of [...document.body.querySelectorAll("*")]) {
  const kids = [...el.children];
  if (kids.length > 12) kids.slice(12).filter((kid) => kid.tagName !== "SCRIPT").forEach((kid) => kid.remove());
}
// Empty wrappers left behind.
for (let pass = 0; pass < 3; pass++) {
  for (const el of document.querySelectorAll("div:empty, span:empty, li:empty, button:empty")) el.remove();
}

const html = `<!doctype html>\n<!-- Trimmed copy of ${pageUrl} (public page), for tests. -->\n${document.documentElement.outerHTML.replace(/\n\s*\n+/g, "\n").replace(/[ \t]{2,}/g, " ")}\n`;
writeFileSync(output, html);
console.log(`${output}: ${Math.round(html.length / 1024)} KB`);

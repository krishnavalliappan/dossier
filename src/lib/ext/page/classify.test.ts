import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { classify, classifyUrl } from "./classify";
import { readPage, type PageRead } from "./read-page";

/**
 * Runs readPage the way the extension does: only its source, evaluated inside
 * the page, so anything it uses from outside itself fails here too.
 */
function read(name: string): { url: string; page: PageRead } {
  const html = readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
  const url = /<!-- Trimmed copy of (\S+) /.exec(html)?.[1] ?? SYNTHETIC[name];
  if (!url) throw new Error(`No URL for fixture ${name}`);
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  return { url, page: dom.window.eval(`(${readPage.toString()})()`) as PageRead };
}

const SYNTHETIC: Record<string, string> = {
  "careers-embed": "https://acme.example/careers/backend-developer",
  "linkedin-signed-in": "https://www.linkedin.com/jobs/view/3998877665/",
  itemlist: "https://acme.example/careers",
};

describe("readPage", () => {
  it("is self-contained, so it runs injected", () => {
    // A bundler helper (esbuild's keepNames __name) would be undefined in the page.
    expect(readPage.toString()).not.toMatch(/__name|__vite|require\(/);
  });

  it.each([
    ["greenhouse-posting", { title: "AI Transformation Owner, CRO", company: "GitLab", location: "Remote, United States" }],
    ["lever-posting", { title: "Administrative Business Partner", company: "Palantir Technologies", location: "Singapore, Singapore", postings: 1 }],
    ["lever-apply", { title: "Administrative Business Partner", company: "Palantir Technologies", location: "Singapore, Singapore", uploads: 1 }],
    ["ashby-posting", { title: "Senior / Staff Fullstack Engineer", company: "Linear", location: "European Union (remote)", postings: 1 }],
    ["linkedin-view", { title: "Senior Software Engineer, Backend", company: "d1g1t", location: "Toronto, Ontario, Canada" }],
    ["linkedin-signed-in", { title: "Backend Developer", company: "Acme", location: "Toronto, ON" }],
  ])("reads %s: title, company and location", (name, expected) => {
    const { page } = read(name);
    expect(page).toMatchObject(expected);
  });

  it("reads the description from the posting's data or its description block, not the page's chrome", () => {
    expect(read("ashby-posting").page.description).toMatch(/^At Linear, we're building/);
    expect(read("greenhouse-posting").page.description).toMatch(/^GitLab is the intelligent orchestration platform/);
    expect(read("linkedin-signed-in").page.description).toMatch(/^About the job/);
    for (const name of ["greenhouse-posting", "lever-posting", "ashby-posting", "linkedin-view"]) expect(read(name).page.description.length, name).toBeGreaterThan(1000);
  });

  it("finds the company's own application behind an aggregator's Apply, and an embedded ATS form", () => {
    expect(read("linkedin-signed-in").page.applyLinks).toContain("https://job-boards.greenhouse.io/acme/jobs/4012345007?gh_src=linkedin");
    expect(read("careers-embed").page.embeds).toEqual([expect.stringContaining("job-boards.greenhouse.io/embed/job_app?for=acme&token=4012345007")]);
  });

  it("counts the postings an ItemList declares", () => {
    expect(read("itemlist").page.postings).toBe(2);
  });
});

describe("classify", () => {
  it.each([
    ["greenhouse-posting", "form", "https://job-boards.greenhouse.io/gitlab/jobs/8638232002"],
    ["greenhouse-board", "list", "https://job-boards.greenhouse.io/gitlab"],
    ["lever-posting", "posting", "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd"],
    ["lever-apply", "form", "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd"],
    ["lever-board", "list", "https://jobs.lever.co/palantir"],
    ["ashby-posting", "posting", "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff"],
    ["linkedin-view", "posting", "https://linkedin.com/jobs/view/4433442194"],
    ["itemlist", "list", "https://acme.example/careers"],
    ["not-a-job", "none", "https://en.wikipedia.org/wiki/R%C3%A9sum%C3%A9"],
  ])("%s is a %s, saved as %s", (name, kind, url) => {
    const { url: pageUrl, page } = read(name);
    expect(classify(pageUrl, page)).toMatchObject({ kind, url });
  });

  it("saves the company's own posting from an aggregator, keeping where it was found", () => {
    const { url, page } = read("linkedin-signed-in");
    const result = classify(url, page);
    expect(result).toMatchObject({ kind: "posting", url: "https://job-boards.greenhouse.io/acme/jobs/4012345007", sourceUrl: "https://linkedin.com/jobs/view/3998877665", site: "linkedin", parsed: { ats: "greenhouse" } });
    expect(result.warning).toBeUndefined();
  });

  it("says so when an aggregator doesn't link to the company", () => {
    const { url, page } = read("linkedin-view");
    expect(classify(url, page).warning).toMatch(/saves the LinkedIn one/);
  });

  it("reads a company careers page with an embedded Greenhouse form as that job's form", () => {
    const { url, page } = read("careers-embed");
    expect(classify(url, page)).toMatchObject({ kind: "form", url: "https://job-boards.greenhouse.io/acme/jobs/4012345007", sourceUrl: "https://acme.example/careers/backend-developer", site: "greenhouse" });
  });

  it("goes by the URL alone before the page is read, and isn't a job without a web address", () => {
    expect(classify("not a url", null).kind).toBe("none");
    expect(classify("https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", null).kind).toBe("posting");
    expect(classify("https://acme.example/careers/backend", null).kind).toBe("none");
  });
});

describe("classifyUrl (the toolbar badge)", () => {
  it.each([
    ["https://job-boards.greenhouse.io/acme/jobs/4012345007", "posting"],
    ["https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab/apply", "form"],
    ["https://www.linkedin.com/jobs/search/?keywords=dev", "list"],
    ["https://www.linkedin.com/jobs/search/?currentJobId=3998877665", "posting"],
    ["https://example.com/", "none"],
    ["chrome://extensions", "none"],
  ])("%s → %s", (url, kind) => expect(classifyUrl(url)).toBe(kind));
});

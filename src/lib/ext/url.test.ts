import { describe, expect, it } from "vitest";

import { cleanUrl, jobKey, parseJobUrl, type JobUrl } from "./url";

// Real shapes of public job URLs (companies and ids made up). Each row:
// the URL, then what it must parse to.
const CASES: [string, Partial<JobUrl>][] = [
  // Greenhouse: both board hosts, the EU host, embeds, a company site with gh_jid, the board itself.
  ["https://boards.greenhouse.io/acme/jobs/4012345007", { kind: "posting", ats: "greenhouse", board: "acme", key: "greenhouse:4012345007", canonical: "https://job-boards.greenhouse.io/acme/jobs/4012345007" }],
  ["https://job-boards.greenhouse.io/acme/jobs/4012345007?gh_src=abc123&utm_source=linkedin", { kind: "posting", key: "greenhouse:4012345007", canonical: "https://job-boards.greenhouse.io/acme/jobs/4012345007" }],
  ["https://job-boards.eu.greenhouse.io/Acme/jobs/4012345007#app", { kind: "posting", board: "acme", key: "greenhouse:4012345007" }],
  ["https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345007", { kind: "apply-form", board: "acme", key: "greenhouse:4012345007", canonical: "https://job-boards.greenhouse.io/acme/jobs/4012345007" }],
  ["https://boards.greenhouse.io/embed/job_board?for=acme", { kind: "list", board: "acme", key: "" }],
  ["https://www.acme.com/careers/job/?gh_jid=4012345007&gh_src=abc", { kind: "posting", ats: "greenhouse", key: "greenhouse:4012345007", canonical: "https://job-boards.greenhouse.io/jobs/4012345007" }],
  ["https://acme.com/careers?gh_jid=4012345007", { key: "greenhouse:4012345007" }],
  ["https://job-boards.greenhouse.io/acme", { kind: "list", board: "acme", key: "" }],
  ["https://boards.greenhouse.io/acme/", { kind: "list", key: "" }],
  // Lever: the posting, its /apply form, the board, the EU host.
  ["https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", { kind: "posting", ats: "lever", board: "acme", key: "lever:1b2c3d4e-0000-4abc-8def-1234567890ab" }],
  ["https://jobs.lever.co/Acme/1B2C3D4E-0000-4ABC-8DEF-1234567890AB/apply?lever-source=LinkedIn", { kind: "apply-form", key: "lever:1b2c3d4e-0000-4abc-8def-1234567890ab", canonical: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab" }],
  ["https://jobs.eu.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", { kind: "posting", key: "lever:1b2c3d4e-0000-4abc-8def-1234567890ab" }],
  ["https://jobs.lever.co/acme?department=Engineering", { kind: "list", key: "" }],
  // Ashby: posting, /application form, board.
  ["https://jobs.ashbyhq.com/acme/5a6b7c8d-1111-4222-8333-444455556666", { kind: "posting", ats: "ashby", board: "acme", key: "ashby:5a6b7c8d-1111-4222-8333-444455556666" }],
  ["https://jobs.ashbyhq.com/acme/5a6b7c8d-1111-4222-8333-444455556666/application?utm_source=x", { kind: "apply-form", key: "ashby:5a6b7c8d-1111-4222-8333-444455556666", canonical: "https://jobs.ashbyhq.com/acme/5a6b7c8d-1111-4222-8333-444455556666" }],
  ["https://jobs.ashbyhq.com/Acme%20Labs", { kind: "list", key: "" }],
  // Workday: myworkdayjobs with and without locale, /apply and its steps, /details, myworkdaysite, the site itself.
  ["https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer_R0012345", { kind: "posting", ats: "workday", board: "acme/external", jobId: "R0012345", key: "workday:acme:R0012345" }],
  ["https://acme.wd3.myworkdayjobs.com/External/job/Toronto-ON/Software-Developer_R0012345", { kind: "posting", key: "workday:acme:R0012345" }],
  ["https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer_R0012345/apply", { kind: "apply-form", key: "workday:acme:R0012345", canonical: "https://acme.wd3.myworkdayjobs.com/External/job/Toronto-ON/Software-Developer_R0012345" }],
  ["https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer_R0012345/apply/applyManually", { kind: "apply-form", key: "workday:acme:R0012345" }],
  ["https://acme.wd5.myworkdayjobs.com/en-US/Careers/details/Backend-Engineer_JR-00451?q=engineer", { kind: "posting", key: "workday:acme:JR-00451" }],
  ["https://wd3.myworkdaysite.com/en-US/recruiting/acme/External/job/Toronto/Software-Developer_R0012345", { kind: "posting", board: "acme/external", key: "workday:acme:R0012345" }],
  ["https://acme.wd3.myworkdayjobs.com/en-US/External?locations=abc", { kind: "list", board: "acme/external", key: "" }],
  // SmartRecruiters.
  ["https://jobs.smartrecruiters.com/Acme/743999912345678-software-developer", { kind: "posting", ats: "smartrecruiters", key: "smartrecruiters:743999912345678", canonical: "https://jobs.smartrecruiters.com/Acme/743999912345678" }],
  ["https://careers.smartrecruiters.com/Acme", { kind: "list", key: "" }],
  // LinkedIn: the job view (bare and slugged), a search with currentJobId, a search without.
  ["https://www.linkedin.com/jobs/view/3998877665/?refId=abc&trackingId=xyz", { kind: "posting", aggregator: "linkedin", key: "linkedin:3998877665", canonical: "https://linkedin.com/jobs/view/3998877665" }],
  ["https://ca.linkedin.com/jobs/view/software-developer-at-acme-3998877665", { kind: "posting", key: "linkedin:3998877665" }],
  ["https://www.linkedin.com/jobs/search/?currentJobId=3998877665&keywords=backend", { kind: "posting", key: "linkedin:3998877665" }],
  ["https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3998877665", { kind: "posting", key: "linkedin:3998877665" }],
  ["https://www.linkedin.com/jobs/search/?keywords=backend&location=Toronto", { kind: "list", aggregator: "linkedin", key: "" }],
  // Indeed: viewjob, a search with vjk, the redirect link, a search.
  ["https://ca.indeed.com/viewjob?jk=0123456789abcdef&from=serp", { kind: "posting", aggregator: "indeed", key: "indeed:0123456789abcdef", canonical: "https://ca.indeed.com/viewjob?jk=0123456789abcdef" }],
  ["https://ca.indeed.com/jobs?q=backend&l=Toronto&vjk=0123456789ABCDEF", { kind: "posting", key: "indeed:0123456789abcdef" }],
  ["https://ca.indeed.com/rc/clk?jk=0123456789abcdef&bb=xyz", { kind: "posting", key: "indeed:0123456789abcdef" }],
  ["https://ca.indeed.com/jobs?q=backend+developer&l=Toronto", { kind: "list", aggregator: "indeed", key: "" }],
  // Glassdoor.
  ["https://www.glassdoor.ca/job-listing/software-developer-acme-JV_IC2281069_KO0,18_KE19,23.htm?jl=1009512345678", { kind: "posting", aggregator: "glassdoor", key: "glassdoor:1009512345678" }],
  ["https://www.glassdoor.ca/Job/toronto-backend-jobs-SRCH_IL.0,7_IC2281069_KO8,15.htm", { kind: "list", aggregator: "glassdoor", key: "" }],
  // Anything else: cleaned, and its own key.
  ["https://careers.acme.com/jobs/123/?utm_source=x&b=2&a=1#top", { kind: "unknown", key: "https://careers.acme.com/jobs/123?a=1&b=2", canonical: "https://careers.acme.com/jobs/123?a=1&b=2" }],
  ["HTTP://WWW.Acme.COM/Jobs/", { kind: "unknown", key: "https://acme.com/Jobs" }],
  ["careers.acme.com/jobs/123", { kind: "unknown", key: "https://careers.acme.com/jobs/123" }],
];

describe("parseJobUrl", () => {
  it.each(CASES)("%s", (url, expected) => {
    expect(parseJobUrl(url)).toMatchObject(expected);
  });

  it("returns null for what isn't a web address", () => {
    expect(parseJobUrl("")).toBeNull();
    expect(parseJobUrl("   ")).toBeNull();
    expect(parseJobUrl("mailto:jobs@acme.com")).toBeNull();
    expect(parseJobUrl("javascript:alert(1)")).toBeNull();
    expect(parseJobUrl("chrome://extensions")).toBeNull();
    expect(parseJobUrl("https://jobs.ashbyhq.com/%E0%A4%A")).toMatchObject({ kind: "unknown" });
  });
});

describe("jobKey", () => {
  // The point of the module: every URL of one job gives the same key.
  const SAME_JOB = [
    ["https://boards.greenhouse.io/acme/jobs/4012345007", "https://job-boards.greenhouse.io/acme/jobs/4012345007?gh_src=x", "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345007", "https://acme.com/careers/?gh_jid=4012345007"],
    ["https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab/apply"],
    ["https://jobs.ashbyhq.com/acme/5a6b7c8d-1111-4222-8333-444455556666", "https://jobs.ashbyhq.com/acme/5a6b7c8d-1111-4222-8333-444455556666/application"],
    [
      "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer_R0012345",
      "https://acme.wd3.myworkdayjobs.com/External/job/Toronto-ON/Software-Developer_R0012345/apply/applyManually",
      "https://wd3.myworkdaysite.com/recruiting/acme/External/job/Toronto/Software-Developer_R0012345",
    ],
    ["https://www.linkedin.com/jobs/view/3998877665/", "https://www.linkedin.com/jobs/search/?currentJobId=3998877665"],
    ["https://ca.indeed.com/viewjob?jk=0123456789abcdef", "https://ca.indeed.com/jobs?q=x&vjk=0123456789abcdef"],
  ];

  it.each(SAME_JOB.map((urls) => [urls[0], urls] as const))("gives every URL of %s one key", (_, urls) => {
    const keys = new Set(urls.map(jobKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).not.toBe("");
  });

  it("keeps different jobs apart", () => {
    expect(jobKey("https://boards.greenhouse.io/acme/jobs/4012345007")).not.toBe(jobKey("https://boards.greenhouse.io/acme/jobs/4012345008"));
    expect(jobKey("https://acme.wd3.myworkdayjobs.com/External/job/X/Dev_R1")).not.toBe(jobKey("https://other.wd3.myworkdayjobs.com/External/job/X/Dev_R1"));
  });

  it("is empty for lists and junk", () => {
    expect(jobKey("https://jobs.lever.co/acme")).toBe("");
    expect(jobKey("not a url at all")).toBe("");
  });
});

describe("cleanUrl", () => {
  it("drops tracking, the fragment and the trailing slash, and sorts the rest", () => {
    expect(cleanUrl(new URL("https://WWW.Example.com/a/b/?z=1&utm_campaign=q&fbclid=1&a=2#x"))).toBe("https://example.com/a/b?a=2&z=1");
  });
});

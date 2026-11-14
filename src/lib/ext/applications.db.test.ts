import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const ai = vi.hoisted(() => ({ configured: true, started: [] as unknown[] }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => ai.configured }));
// The job itself is tested on its own; here only that it's queued, once.
vi.mock("@/lib/jobs/runner", async (original) => ({
  ...(await original<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async (definition: { type: string }, input: unknown, options: { key: string; applicationId: string }) => {
    ai.started.push({ type: definition.type, input, ...options });
    return (await db.client!.job.create({ data: { type: definition.type, key: options.key, applicationId: options.applicationId, input: input as object } })).id;
  }),
}));
const prisma = () => db.client!;

const { findApplications, linkUrl, markApplied, saveFromExtension, suggestApplications } = await import("./applications");

const POSTING = "https://job-boards.greenhouse.io/acme/jobs/4012345007";

beforeEach(async () => {
  await resetDatabase(prisma());
  ai.configured = true;
  ai.started = [];
});
afterAll(() => prisma().$disconnect());

describe("saveFromExtension", () => {
  it("saves a Draft with what the page said, its canonical link and where it was found", async () => {
    const result = await saveFromExtension({
      url: `${POSTING}?gh_src=abc`,
      sourceUrl: "https://www.linkedin.com/jobs/view/3998877665/",
      title: "Backend Developer",
      company: "Acme",
      location: "Toronto, ON",
      description: "We build things.  With   spaces.",
    });
    expect(result).toMatchObject({ existing: false, tailoring: "off", application: { title: "Backend Developer · Acme", status: "DRAFT", statusLabel: "Draft", resume: "missing", letter: "missing" } });
    const row = await prisma().application.findUniqueOrThrow({ where: { id: result.application.id } });
    expect(row).toMatchObject({ company: "Acme", role: "Backend Developer", location: "Toronto, ON", postingUrl: POSTING, postingText: "We build things.  With   spaces." });
    const links = await prisma().extJobUrl.findMany({ orderBy: { role: "asc" } });
    expect(links.map((link) => [link.role, link.key])).toEqual([
      ["posting", "greenhouse:4012345007"],
      ["source", "linkedin:3998877665"],
    ]);
  });

  it("finds the same job again from its apply form, its embed, or the page it was found on", async () => {
    const { application } = await saveFromExtension({ url: POSTING, sourceUrl: "https://www.linkedin.com/jobs/view/3998877665/", company: "Acme" });
    for (const url of ["https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345007", "https://acme.com/careers?gh_jid=4012345007", "https://www.linkedin.com/jobs/search/?currentJobId=3998877665"]) {
      expect((await findApplications(url)).map((match) => match.id), url).toEqual([application.id]);
    }
    const again = await saveFromExtension({ url: "https://boards.greenhouse.io/acme/jobs/4012345007", company: "Acme" });
    expect(again).toMatchObject({ existing: true, application: { id: application.id } });
    expect(await prisma().application.count()).toBe(1);
  });

  it("never makes two applications from two saves at once", async () => {
    const results = await Promise.all([saveFromExtension({ url: POSTING }), saveFromExtension({ url: POSTING })]);
    expect(new Set(results.map((result) => result.application.id)).size).toBe(1);
    expect(await prisma().application.count()).toBe(1);
  });

  it("matches an application made in Dossier by its posting link", async () => {
    const made = await prisma().application.create({ data: { title: "By hand", postingUrl: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab" } });
    expect((await findApplications("https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab/apply")).map((match) => match.id)).toEqual([made.id]);
    expect((await saveFromExtension({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab" })).existing).toBe(true);
  });

  it("refuses a list page and what isn't a URL", async () => {
    await expect(saveFromExtension({ url: "https://jobs.lever.co/acme" })).rejects.toMatchObject({ code: "bad-request", message: expect.stringContaining("lists many jobs") });
    await expect(saveFromExtension({ url: "mailto:x@y.z" })).rejects.toMatchObject({ code: "bad-request" });
    expect(await findApplications("https://jobs.lever.co/acme")).toEqual([]);
  });

  it("saves the job again after its application was deleted", async () => {
    const first = await saveFromExtension({ url: POSTING });
    await prisma().application.delete({ where: { id: first.application.id } });
    expect(await findApplications(POSTING)).toEqual([]);
    const second = await saveFromExtension({ url: POSTING });
    expect(second.existing).toBe(false);
    expect(second.application.id).not.toBe(first.application.id);
  });

  it("starts tailoring once when asked, and says when there's no AI", async () => {
    const result = await saveFromExtension({ url: POSTING, tailor: true });
    expect(result.tailoring).toBe("started");
    expect(ai.started).toEqual([{ type: "ext-tailor", input: { applicationId: result.application.id }, key: `ext-tailor:${result.application.id}`, applicationId: result.application.id }]);
    expect((await findApplications(POSTING))[0]).toMatchObject({ resume: "writing", letter: "writing" });

    ai.configured = false;
    expect((await saveFromExtension({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", tailor: true })).tailoring).toBe("no-ai");
  });

  it("reports a document as ready, or failed when its job failed", async () => {
    const { application } = await saveFromExtension({ url: POSTING });
    await prisma().document.create({ data: { applicationId: application.id, kind: "RESUME", units: [] } });
    await prisma().job.create({ data: { type: "write-document", key: `document:${application.id}:COVER_LETTER`, applicationId: application.id, input: {}, status: "FAILED" } });
    expect((await findApplications(POSTING))[0]).toMatchObject({ resume: "ready", letter: "failed" });
  });
});

describe("linkUrl", () => {
  it("links an application form to a job saved from elsewhere, once", async () => {
    const { application } = await saveFromExtension({ url: "https://www.linkedin.com/jobs/view/3998877665/" });
    await linkUrl(application.id, "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto/Dev_R1/apply");
    expect((await findApplications("https://acme.wd3.myworkdayjobs.com/External/job/Toronto/Dev_R1")).map((match) => match.id)).toEqual([application.id]);
    await linkUrl(application.id, "https://acme.wd3.myworkdayjobs.com/External/job/Toronto/Dev_R1");
    expect(await prisma().extJobUrl.count()).toBe(2);
  });

  it("refuses a page linked to another application, and a list", async () => {
    const one = await saveFromExtension({ url: POSTING });
    const two = await saveFromExtension({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab" });
    await expect(linkUrl(two.application.id, POSTING)).rejects.toMatchObject({ code: "conflict" });
    await expect(linkUrl(one.application.id, "https://jobs.lever.co/acme")).rejects.toMatchObject({ code: "bad-request" });
    await expect(linkUrl("missing", POSTING)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("suggestApplications", () => {
  it("finds open applications by the company's or title's words, newest first; the newest Drafts without a query", async () => {
    const acme = await saveFromExtension({ url: POSTING, company: "Acme Corp", title: "Backend Developer" });
    const other = await saveFromExtension({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4abc-8def-1234567890ab", company: "Acmeist", title: "Designer" });
    const archived = await prisma().application.create({ data: { title: "Old · Acme Corp", company: "Acme Corp", archivedAt: new Date() } });
    expect((await suggestApplications("acme corp")).map((app) => app.id)).toEqual([acme.application.id]);
    expect((await suggestApplications("ACME")).map((app) => app.id)).toEqual([acme.application.id]);
    expect((await suggestApplications("")).map((app) => app.id)).toEqual([other.application.id, acme.application.id]);
    await markApplied(other.application.id);
    expect((await suggestApplications("")).map((app) => app.id)).toEqual([acme.application.id]);
    expect((await suggestApplications("Acme Corp")).map((app) => app.id)).not.toContain(archived.id);
  });
});

describe("markApplied", () => {
  it("moves a Draft to Sent once, and leaves one further along alone", async () => {
    const { application } = await saveFromExtension({ url: POSTING });
    expect(await markApplied(application.id)).toMatchObject({ changed: true, application: { status: "SENT", statusLabel: "Sent" } });
    expect(await markApplied(application.id)).toMatchObject({ changed: false, application: { status: "SENT" } });
    expect(await prisma().statusEvent.count({ where: { applicationId: application.id } })).toBe(1);
    await prisma().application.update({ where: { id: application.id }, data: { status: "INTERVIEW" } });
    expect(await markApplied(application.id)).toMatchObject({ changed: false, application: { status: "INTERVIEW" } });
    await expect(markApplied("missing")).rejects.toMatchObject({ code: "not-found" });
  });
});

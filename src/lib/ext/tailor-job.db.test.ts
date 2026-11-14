import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const state = vi.hoisted(() => ({ started: [] as { input: unknown; key: string }[], writes: "both" }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/ai", () => ({
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) =>
        call.json?.name === "extracted_posting"
          ? { title: null, company: "Acme", role: "Backend Developer", location: "Toronto", mode: null, salary: null, deadline: null, requirements: [{ text: "Python", kind: "skill", skill: "Python", years: null, language: null }], asksForReferences: false, language: "English" }
          : { matches: [] },
    }),
}));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ documentsToWrite: state.writes }) }));
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T,>(definition: T) => definition,
  findUnfinishedJobs: async () => [],
  startJob: async (_definition: unknown, input: unknown, options: { key: string }) => {
    state.started.push({ input, key: options.key });
    return "job";
  },
}));
const prisma = () => db.client!;

const { extTailorJob } = await import("./tailor-job");
const context = { id: "job", step: async () => {}, signal: new AbortController().signal };

beforeEach(async () => {
  await resetDatabase(prisma());
  state.started = [];
  state.writes = "both";
});
afterAll(() => prisma().$disconnect());

describe("extTailorJob", () => {
  it("reads the posting, fills what the page didn't say, then queues both documents", async () => {
    const app = await prisma().application.create({ data: { title: "", company: "", role: "Backend Developer", postingText: "Acme wants Python." } });
    const result = await extTailorJob.run({ applicationId: app.id }, context);
    expect(result).toEqual({ applicationId: app.id, writing: ["RESUME", "COVER_LETTER"] });
    const row = await prisma().application.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ company: "Acme", role: "Backend Developer", location: "Toronto", title: "Backend Developer · Acme", extractedWith: "extract-posting@2" });
    expect(state.started.map((job) => job.key)).toEqual([`document:${app.id}:RESUME`, `document:${app.id}:COVER_LETTER`]);
  });

  it("follows Settings → which documents to write, and skips one already written", async () => {
    state.writes = "resume";
    const app = await prisma().application.create({ data: { title: "T", postingText: "x", extracted: {} } });
    await prisma().document.create({ data: { applicationId: app.id, kind: "RESUME", units: [] } });
    expect((await extTailorJob.run({ applicationId: app.id }, context)).writing).toEqual([]);
    expect(state.started).toEqual([]);
  });

  it("does nothing for an application deleted meanwhile", async () => {
    expect(await extTailorJob.run({ applicationId: "gone" }, context)).toEqual({ applicationId: "gone", writing: [] });
  });
});

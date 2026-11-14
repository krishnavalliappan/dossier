import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { formatReport, importBank } from "./apply";
import { parseBank } from "./parse";

const db = createTestClient();
const demo = parseBank(readFileSync(new URL("./fixtures/demo-bank.md", import.meta.url), "utf8"));

beforeEach(async () => {
  await resetDatabase(db);
  await db.experience.createMany({
    data: [
      { id: "northwind", role: "Senior Product Designer", company: "Northwind Logistics", bullets: "Old bullet", sort: 0 },
      { id: "fieldnote", role: "Product Designer", company: "Fieldnote", bullets: "Hand-written", sort: 1 },
      { id: "brik", role: "UX Designer", company: "Studio Brik", bullets: "Untouched", sort: 2 },
    ],
  });
  await db.project.create({ data: { id: "tidewater", name: "Tidewater design tokens", bullets: "Old project bullet" } });
});
afterAll(() => db.$disconnect());

const bullets = async (id: string) => (await db.experience.findUniqueOrThrow({ where: { id } })).bullets;

describe("importBank", () => {
  it("writes only approved neutral bullets into the roles and projects the bank names", async () => {
    const report = await importBank(db, demo);
    expect(await bullets("northwind")).toBe(
      [
        "Led the redesign of the dispatch console used by 400 drivers.",
        "Cut route-planning time by 30% with a new map view.",
        "Shipped a bilingual (English/French) multi-tenant onboarding flow.",
        "Designed audit-ready workflows for regulated B2B clients.",
      ].join("\n"),
    );
    expect(await bullets("fieldnote")).toBe(
      ["Built the field-survey app's offline mode with the mobile team.", "Prototyping AI-assisted note summaries.", "Interviewed 40 users to shape the survey builder."].join("\n"),
    );
    expect(await bullets("brik")).toBe("Untouched");
    expect((await db.project.findUniqueOrThrow({ where: { id: "tidewater" } })).bullets).toBe("Published an open-source token pipeline used by 3 teams.");
    expect(report.unmatched).toEqual([{ heading: "Unknown Role @ Nowhere Inc", ids: ["Z1"] }]);
    expect(report.changes).toEqual({ upserted: 10, removed: 0, profileEntries: 3 });
  });

  it("keeps every variant, so tailoring can choose", async () => {
    await importBank(db, demo);
    const rows = await db.bankBullet.findMany({ where: { baseId: { in: ["D1", "B4"] } }, orderBy: { sort: "asc" } });
    expect(rows.map((row) => [row.id, row.variant, row.targetId])).toEqual([
      ["D1-N", "neutral", "northwind"],
      ["D1-H", "healthcare", "northwind"],
      ["B4-N", "neutral", "fieldnote"],
      ["B4-H", "healthcare", "fieldnote"],
    ]);
  });

  it("is idempotent: running it again changes nothing and duplicates nothing", async () => {
    await importBank(db, demo);
    const first = await db.bankBullet.findMany({ orderBy: { id: "asc" }, select: { id: true, text: true, sort: true } });
    await importBank(db, demo);
    expect(await db.bankBullet.findMany({ orderBy: { id: "asc" }, select: { id: true, text: true, sort: true } })).toEqual(first);
    expect(await db.bankClaimBlock.count()).toBe(2);
  });

  it("removes a bullet taken back, and empties an entry the bank no longer fills", async () => {
    await importBank(db, demo);
    const trimmed = parseBank(readFileSync(new URL("./fixtures/demo-bank.md", import.meta.url), "utf8").replace(/^- \*\*G1\*\*.*$/m, "").replace("A2** ✅ VERIFIED · status: APPROVED", "A2** ✅ VERIFIED · status: DRAFT"));
    const report = await importBank(db, trimmed);
    expect(report.changes.removed).toBe(2);
    expect(await bullets("northwind")).not.toContain("route-planning");
    expect((await db.project.findUniqueOrThrow({ where: { id: "tidewater" } })).bullets).toBe("");
  });

  it("writes nothing in a dry run", async () => {
    const report = await importBank(db, demo, { dryRun: true });
    expect(report.changes.upserted).toBe(10);
    expect(await db.bankBullet.count()).toBe(0);
    expect(await bullets("northwind")).toBe("Old bullet");
    expect(formatReport(report, true)).toMatch(/^Dry run/);
  });

  it("says when the result is too thin to tailor", async () => {
    const tiny = parseBank("## Senior Product Designer @ Northwind Logistics\n- **A1** status: APPROVED — One.\n- **A2** status: APPROVED — Two.\n- **A3** status: APPROVED — Three.");
    const report = await importBank(db, tiny);
    expect(report.thin).toEqual(["Only 3 approved bullets reached the profile; tailoring needs at least 8 to choose from."]);
    expect(formatReport(report, false)).toContain("⚠ Too thin to tailor");
    expect((await importBank(db, demo)).thin).toEqual(["Tidewater design tokens has 1 approved bullet."]);
  });
});

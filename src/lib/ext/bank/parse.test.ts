import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { approvedBullets, blockedIn, parseBank, plainText } from "./parse";

const demo = readFileSync(new URL("./fixtures/demo-bank.md", import.meta.url), "utf8");

describe("parseBank", () => {
  const bank = parseBank(demo);
  const byId = (id: string) => bank.bullets.find((bullet) => bullet.id === id);

  it("reads ids, tiers, statuses and text from one line", () => {
    expect(byId("A1")).toMatchObject({
      baseId: "A1",
      variant: "neutral",
      tier: "VERIFIED",
      status: "APPROVED",
      heading: "Senior Product Designer @ Northwind Logistics",
      text: "Led the redesign of the dispatch console used by 400 drivers.",
    });
    expect(byId("B5")).toMatchObject({ tier: "IN_PROGRESS", status: "APPROVED" });
  });

  it("reads variants from id suffixes", () => {
    expect(byId("D1-N")).toMatchObject({ baseId: "D1", variant: "neutral" });
    expect(byId("D1-H")).toMatchObject({ baseId: "D1", variant: "healthcare", text: expect.stringContaining("clinics") });
  });

  it("reads variants and status from sub-items", () => {
    expect(byId("B4-N")).toMatchObject({ baseId: "B4", variant: "neutral", status: "APPROVED", tier: "VERIFIED", heading: "Product Designer @ Fieldnote" });
    expect(byId("B4-H")).toMatchObject({ baseId: "B4", variant: "healthcare", text: expect.stringContaining("nurses") });
    expect(byId("B4")).toBeUndefined();
  });

  it("reads an entry written as a heading with its text below", () => {
    expect(byId("C1")).toMatchObject({ status: "APPROVED", text: "Interviewed 40 users to shape the survey builder.", heading: "Product Designer @ Fieldnote" });
  });

  it("reads the DO NOT CLAIM list without treating it as bullets", () => {
    expect(bank.blocked).toEqual(["100+ client organizations", "Managed a team"]);
    expect(bank.headings.map((heading) => heading.text)).not.toContain("DO NOT CLAIM");
  });

  it("lists the headings that have bullets", () => {
    expect(bank.headings.map((heading) => heading.text)).toEqual([
      "Senior Product Designer @ Northwind Logistics",
      "Product Designer @ Fieldnote",
      "Tidewater design tokens",
      "Unknown Role @ Nowhere Inc",
    ]);
  });

  it("never throws on junk", () => {
    expect(parseBank("")).toEqual({ bullets: [], headings: [], blocked: [] });
    expect(parseBank("# Hi\n\n- not an id\n- **ab** nope").bullets).toEqual([]);
  });
});

describe("approvedBullets", () => {
  const { approved, rejected } = approvedBullets(parseBank(demo));
  const reason = (id: string) => rejected.find((entry) => entry.id === id)?.reason;

  it("keeps only APPROVED bullets", () => {
    expect(approved.map((bullet) => bullet.id)).toEqual(["A1", "A2", "A4", "D1-N", "D1-H", "B4-N", "B4-H", "B5", "C1", "G1", "Z1"]);
  });

  it("refuses drafts, ⟦N⟧ placeholders and DO NOT CLAIM phrases, saying why", () => {
    expect(reason("A3")).toBe("status is DRAFT");
    expect(reason("B6")).toMatch(/DO NOT CLAIM/);
    const placeholder = approvedBullets(parseBank("## R @ C\n- **X1** status: APPROVED — Ran ⟦N⟧ teams."));
    expect(placeholder.rejected[0].reason).toMatch(/⟦N⟧/);
  });

  it("refuses an id used twice and a bullet without text", () => {
    const { approved: kept, rejected: refused } = approvedBullets(parseBank("## R @ C\n- **X1** status: APPROVED — One.\n- **X1** status: APPROVED — Two.\n- **X2** status: APPROVED"));
    expect(kept.map((bullet) => bullet.text)).toEqual(["One."]);
    expect(refused.map((entry) => entry.reason)).toEqual(["its id is used twice; the first one is kept", "it has no text"]);
  });
});

describe("blockedIn", () => {
  it("matches whole words, ignoring case and markdown", () => {
    expect(blockedIn("Owned research for **100+ Client Organizations**.", ["100+ client organizations"])).toBe("100+ client organizations");
    expect(blockedIn("Managed a teammate's rollout", ["Managed a team"])).toBeUndefined();
    expect(blockedIn("anything", [""])).toBeUndefined();
  });

  it("strips emphasis in plainText", () => {
    expect(plainText("**Bold** and _it_  and `code`")).toBe("Bold and it and code");
  });
});

import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { guardClaims, isHealthtech, withVariants, type BankRow } from "./tailor";

describe("isHealthtech", () => {
  it("needs two different health terms", () => {
    expect(isHealthtech("Build EHR integrations used by clinicians in 200 hospitals.")).toBe(true);
    expect(isHealthtech("We build tools for patients and their clinics.")).toBe(true);
    expect(isHealthtech("Backend developer for our logistics platform.")).toBe(false);
  });

  it("ignores benefits talk", () => {
    expect(isHealthtech("Perks: health benefits, health and dental, medical leave.")).toBe(false);
  });

  it("counts the company name", () => {
    expect(isHealthtech("Join our patient experience team.", "Northwind Healthcare")).toBe(true);
  });
});

describe("withVariants", () => {
  const profile = demoProfile();
  const role = profile.experience[0];
  const rows: BankRow[] = [
    { id: "A1", baseId: "A1", variant: "neutral", targetId: role.id, text: "Plain bullet.", sort: 0 },
    { id: "D1-N", baseId: "D1", variant: "neutral", targetId: role.id, text: "Regulated B2B clients.", sort: 1 },
    { id: "D1-H", baseId: "D1", variant: "healthcare", targetId: role.id, text: "Clinics handling patient records.", sort: 2 },
  ];

  it("swaps in the healthcare wording for healthtech, keeping the bank's order", () => {
    const swapped = withVariants(profile, rows, true);
    expect(swapped.experience[0].bullets).toBe("Plain bullet.\nClinics handling patient records.");
    expect(swapped.experience[1]).toEqual(profile.experience[1]);
  });

  it("leaves the profile as it is otherwise", () => {
    expect(withVariants(profile, rows, false)).toBe(profile);
    expect(withVariants(profile, [], true)).toBe(profile);
  });
});

describe("guardClaims", () => {
  const blocked = ["100+ client organizations", "Managed a team"];

  it("cuts only the sentence or line that says a blocked phrase", () => {
    const { units, cut } = guardClaims(
      [
        { id: "summary", label: "Summary", text: "Designer for B2B SaaS. Served 100+ client organizations across Canada. Bilingual." },
        { id: "role:1", label: "Role", text: "Shipped the onboarding flow.\nManaged a team of five designers.\nRan research." },
        { id: "skills", label: "Skills", text: "Figma, research" },
      ],
      blocked,
    );
    expect(units.map((unit) => unit.text)).toEqual(["Designer for B2B SaaS. Bilingual.", "Shipped the onboarding flow.\nRan research.", "Figma, research"]);
    expect(cut).toEqual(["100+ client organizations", "Managed a team"]);
  });

  it("keeps the units untouched without a list", () => {
    const units = [{ id: "a", label: "A", text: "Managed a team." }];
    expect(guardClaims(units, []).units).toEqual(units);
  });
});

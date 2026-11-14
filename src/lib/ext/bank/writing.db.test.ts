import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { bankWriting } from "./writing";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const profile = demoProfile();
const roleId = profile.experience[0].id;

beforeEach(async () => {
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("bankWriting", () => {
  it("leaves everything as it is without a bank", async () => {
    const bank = await bankWriting(profile, "Hospital EHR work with patients.");
    expect(bank.profile).toBe(profile);
    const units = [{ id: "a", label: "A", text: "Managed a team." }];
    expect(bank.guard(units)).toEqual(units);
  });

  it("uses the healthcare wording for healthtech postings and cuts DO NOT CLAIM phrases", async () => {
    await prisma().bankBullet.createMany({
      data: [
        { id: "D1-N", baseId: "D1", variant: "neutral", targetKind: "experience", targetId: roleId, text: "Neutral wording.", sort: 0 },
        { id: "D1-H", baseId: "D1", variant: "healthcare", targetKind: "experience", targetId: roleId, text: "Clinic wording.", sort: 1 },
      ],
    });
    await prisma().bankClaimBlock.create({ data: { phrase: "Managed a team" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const health = await bankWriting(profile, "We build EHR software for clinics and their patients.");
    expect(health.profile.experience[0].bullets).toBe("Clinic wording.");
    expect(health.guard([{ id: "a", label: "A", text: "Shipped it. Managed a team of 4." }])[0].text).toBe("Shipped it.");

    const plain = await bankWriting(profile, "Logistics backend.");
    expect(plain.profile).toBe(profile);
    spy.mockRestore();
  });
});

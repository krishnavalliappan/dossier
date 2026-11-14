import "server-only";

import type { Unit } from "@/lib/application-data";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";

import { guardClaims, isHealthtech, withVariants } from "./tailor";

/**
 * Fork-only hook for the jobs that write documents: the profile in this
 * posting's wording, and a guard that cuts DO NOT CLAIM phrases from what
 * the AI wrote. Without a bank imported, both leave everything as it is.
 */
export async function bankWriting(profile: ProfileData, posting: string, company = ""): Promise<{ profile: ProfileData; guard: (units: Unit[]) => Unit[] }> {
  const [rows, blocks] = await Promise.all([
    prisma.bankBullet.findMany({ select: { id: true, baseId: true, variant: true, targetId: true, text: true, sort: true } }),
    prisma.bankClaimBlock.findMany({ select: { phrase: true } }),
  ]);
  const blocked = blocks.map((block) => block.phrase);
  return {
    profile: withVariants(profile, rows, isHealthtech(posting, company)),
    guard: (units) => {
      const result = guardClaims(units, blocked);
      if (result.cut.length) logServerError("bank guard", new Error(`Cut ${result.cut.length} DO NOT CLAIM phrase(s) from a document.`));
      return result.units;
    },
  };
}

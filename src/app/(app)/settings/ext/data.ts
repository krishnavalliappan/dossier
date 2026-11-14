import "server-only";

// Fork-only: what Settings → Extension & ATS shows.

import { prisma } from "@/lib/prisma";
import type { SettingsData } from "@/lib/settings";

export async function extensionSectionProps(settings: Pick<SettingsData, "atsReadingOrder">) {
  const [bullets, entries, blocked] = await Promise.all([
    prisma.bankBullet.count(),
    prisma.bankBullet.groupBy({ by: ["targetId"] }).then((groups) => groups.length),
    prisma.bankClaimBlock.count(),
  ]);
  return { initial: { atsReadingOrder: settings.atsReadingOrder }, bank: { bullets, entries, blocked } };
}

import "server-only";

// Fork-only: what Settings → Extension & ATS shows.

import { listTokens } from "@/lib/ext/tokens";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SettingsData } from "@/lib/settings";
import { requestOrigin } from "@/lib/settings-views";

import { tokenRow } from "./token-row";

export async function extensionSectionProps(settings: Pick<SettingsData, "atsReadingOrder">) {
  const [bullets, entries, blocked, tokens, origin] = await Promise.all([
    prisma.bankBullet.count(),
    prisma.bankBullet.groupBy({ by: ["targetId"] }).then((groups) => groups.length),
    prisma.bankClaimBlock.count(),
    listTokens(),
    requestOrigin(),
  ]);
  return {
    initial: { atsReadingOrder: settings.atsReadingOrder },
    bank: { bullets, entries, blocked },
    tokens: tokens.map(tokenRow),
    serverUrl: env.DOSSIER_PUBLIC_URL ?? origin,
  };
}

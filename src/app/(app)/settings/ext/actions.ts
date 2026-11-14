"use server";

// Fork-only: Settings → Extension & ATS.

import { z } from "zod";

import { action } from "@/lib/action";
import { saveSettings } from "@/lib/settings-data";

/** Settings → ATS reading order. */
export const saveAtsReadingOrder = action(z.boolean(), async (on) => {
  await saveSettings({ atsReadingOrder: on });
  return null;
});

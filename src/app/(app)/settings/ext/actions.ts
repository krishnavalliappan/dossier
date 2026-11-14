"use server";

// Fork-only: Settings → Extension & ATS.

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { createToken, EXT_SCOPES, listTokens, revokeToken } from "@/lib/ext/tokens";
import { saveSettings } from "@/lib/settings-data";

import { tokenRow } from "./token-row";

/** Settings → ATS reading order. */
export const saveAtsReadingOrder = action(z.boolean(), async (on) => {
  await saveSettings({ atsReadingOrder: on });
  return null;
});

/** Makes a token for the extension; the token itself comes back only this once. */
export const createExtToken = action(
  z.strictObject({ name: z.string().trim().max(60), scopes: z.array(z.enum(EXT_SCOPES)).min(1, "Pick at least one permission.") }),
  async ({ name, scopes }, { toast }) => {
    const { token } = await createToken(name, scopes);
    toast("Token made. Copy it now: it won't be shown again.");
    return { token, tokens: (await listTokens()).map(tokenRow) };
  },
);

export const revokeExtToken = action(z.strictObject({ id: z.string().min(1).max(64) }), async ({ id }, { toast }) => {
  if (!(await revokeToken(id))) throw new ActionError("That token was already revoked.");
  toast("Token revoked. The extension using it is signed out.");
  return { tokens: (await listTokens()).map(tokenRow) };
});

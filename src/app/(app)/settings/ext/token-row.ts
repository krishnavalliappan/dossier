import type { ExtScope, TokenView } from "@/lib/ext/tokens";

/** A token as Settings shows it: dates as ISO strings, never the token. */
export type TokenRow = { id: string; name: string; prefix: string; scopes: ExtScope[]; createdAt: string; lastUsedAt: string | null; valid: boolean };

export const tokenRow = (token: TokenView): TokenRow => ({
  ...token,
  createdAt: token.createdAt.toISOString(),
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
});

import { NextResponse } from "next/server";

import { extRoute } from "@/lib/ext/route";
import { appVersion } from "@/lib/version";

/** Fork: whether the extension's token works, and what it may do. */
export const GET = extRoute([], async (_request, _context, token) => NextResponse.json({ ok: true, version: appVersion, scopes: token.scopes }));

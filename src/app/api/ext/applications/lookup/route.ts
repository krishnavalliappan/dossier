import { NextResponse } from "next/server";

import { findApplications } from "@/lib/ext/applications";
import { ExtError, extRoute } from "@/lib/ext/route";
import { parseJobUrl } from "@/lib/ext/url";

/** Fork: the applications for the job at ?url=, best first, and what the URL is. */
export const GET = extRoute(["applications:read"], async (request) => {
  const url = request.nextUrl.searchParams.get("url") ?? "";
  const page = parseJobUrl(url);
  if (!page) throw new ExtError("bad-request", "That isn't a web address.");
  return NextResponse.json({ page, matches: await findApplications(url) });
});

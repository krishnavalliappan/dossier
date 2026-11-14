import { NextResponse } from "next/server";
import { z } from "zod";

import { linkUrl } from "@/lib/ext/applications";
import { ExtError, extRoute } from "@/lib/ext/route";

const body = z.strictObject({ url: z.string().trim().min(1).max(2000) });

/** Fork: links another page of the same job (its application form) to the application. */
export const POST = extRoute<RouteContext<"/api/ext/applications/[id]/urls">>(["applications:write"], async (request, { params }) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ExtError("bad-request", "The extension sent something Dossier can't read. Update the extension.");
  return NextResponse.json({ application: await linkUrl((await params).id, parsed.data.url) });
});

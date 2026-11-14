import { NextResponse } from "next/server";

import { getApplication, startTailoring } from "@/lib/ext/applications";
import { extRoute } from "@/lib/ext/route";

/** Fork: starts writing the documents the application doesn't have yet. */
export const POST = extRoute<RouteContext<"/api/ext/applications/[id]/tailor">>(["applications:write"], async (_request, { params }) => {
  const { id } = await params;
  await getApplication(id);
  const tailoring = await startTailoring(id);
  return NextResponse.json({ tailoring, application: await getApplication(id) });
});

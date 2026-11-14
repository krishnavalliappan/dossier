import { NextResponse } from "next/server";

import { markApplied } from "@/lib/ext/applications";
import { extRoute } from "@/lib/ext/route";

/** Fork: marks the application applied (Sent), once; a second call changes nothing. */
export const POST = extRoute<RouteContext<"/api/ext/applications/[id]/applied">>(["applications:write"], async (_request, { params }) =>
  NextResponse.json(await markApplied((await params).id)),
);

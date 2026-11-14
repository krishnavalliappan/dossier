import { NextResponse } from "next/server";

import { getApplication } from "@/lib/ext/applications";
import { extRoute } from "@/lib/ext/route";

/** Fork: one application, with how far its documents are. */
export const GET = extRoute<RouteContext<"/api/ext/applications/[id]">>(["applications:read"], async (_request, { params }) =>
  NextResponse.json({ application: await getApplication((await params).id) }),
);

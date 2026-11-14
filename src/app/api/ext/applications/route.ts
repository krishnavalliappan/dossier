import { NextResponse } from "next/server";
import { z } from "zod";

import { saveFromExtension } from "@/lib/ext/applications";
import { ExtError, extRoute } from "@/lib/ext/route";

const body = z.strictObject({
  url: z.string().trim().min(1).max(2000),
  sourceUrl: z.string().trim().max(2000).optional(),
  title: z.string().max(500).optional(),
  company: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  description: z.string().max(200_000).optional(),
  tailor: z.boolean().optional(),
});

/** Fork: saves the job the extension is on; the same job again returns the first application (200 instead of 201). */
export const POST = extRoute(["applications:write"], async (request) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ExtError("bad-request", "The extension sent something Dossier can't read. Update the extension.");
  const result = await saveFromExtension(parsed.data);
  return NextResponse.json(result, { status: result.existing ? 200 : 201 });
});

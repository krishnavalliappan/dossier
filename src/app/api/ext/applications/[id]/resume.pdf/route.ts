import { renderApplicationPdf } from "@/lib/ext/pdf";
import { extRoute } from "@/lib/ext/route";
import { pdfDownload } from "@/lib/pdf/downloads";

/** Fork: the application's tailored resume as a PDF, named as Dossier names downloads. */
export const GET = extRoute<RouteContext<"/api/ext/applications/[id]/resume.pdf">>(["resume:read"], async (_request, { params }) => {
  const { pdf, fileName } = await renderApplicationPdf((await params).id, "resume");
  return pdfDownload(pdf, fileName);
});

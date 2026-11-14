import "server-only";

// Fork-only: an application's tailored resume or cover letter as a PDF, for
// the extension to attach. The same render and file name as Dossier's own
// download (src/app/api/pdf/route.ts), kept apart to leave that file as it is.

import { DocumentKind } from "@/generated/prisma/enums";
import { resolveFileName } from "@/lib/file-name";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { FIT_LEVELS } from "@/lib/themes";

import { ExtError } from "./route";

const DOCS = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

export async function renderApplicationPdf(id: string, doc: keyof typeof DOCS): Promise<{ pdf: Uint8Array; fileName: string }> {
  const application = APPLICATION_ID.test(id)
    ? await prisma.application.findUnique({ where: { id }, select: { company: true, role: true, documents: { where: { kind: DOCS[doc] }, select: { id: true } } } })
    : null;
  if (!application) throw new ExtError("not-found", "That application is no longer in Dossier.");
  if (application.documents.length === 0) {
    throw new ExtError("not-ready", doc === "resume" ? "This job's tailored resume isn't written yet." : "This job has no cover letter yet.");
  }
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  // One page, as resumes are in Canada: squeezed a step at a time until it fits, as Fit to one page does for the base resume.
  let pdf = await renderPdf(`/print/${doc}/${id}`);
  for (let fit = 1; doc === "resume" && fit <= FIT_LEVELS && countPdfPages(pdf) > 1; fit++) pdf = await renderPdf(`/print/${doc}/${id}?fit=${fit}`);
  return {
    pdf,
    fileName: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: DOCS[doc], date: new Date() }),
  };
}

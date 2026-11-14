import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { DocumentKind } from "@/generated/prisma/enums";
import { loadDocuments } from "@/lib/application-documents";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { printMetadata } from "@/lib/pdf/print-title";
import { FIT_LEVELS, printCss } from "@/lib/themes";

/** Fork: `?fit=1` to `?fit=4` squeeze a tailored resume as the base resume's are, for the extension's one-page PDF. */
const fitLevel = (value: string | string[] | undefined) => {
  const level = Number(typeof value === "string" ? value : 0);
  return Number.isInteger(level) && level > 0 ? Math.min(level, FIT_LEVELS) : 0;
};

export async function generateMetadata({ params, searchParams }: PageProps<"/print/[doc]/[id]">): Promise<Metadata> {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter") notFound();
  const fit = doc === "resume" ? fitLevel((await searchParams).fit) : 0;
  await verifyPrintAccess(`/print/${doc}/${id}${fit ? `?fit=${fit}` : ""}`);
  return printMetadata(doc === "resume" ? DocumentKind.RESUME : DocumentKind.COVER_LETTER);
}

/**
 * An application's tailored resume (/print/resume/{id}) or cover letter
 * (/print/letter/{id}) on its own, for the PDF renderer (E8-8) to print.
 */
export default async function PrintTailoredDocumentPage({ params, searchParams }: PageProps<"/print/[doc]/[id]">) {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter") notFound();
  const fit = doc === "resume" ? fitLevel((await searchParams).fit) : 0;
  await verifyPrintAccess(`/print/${doc}/${id}${fit ? `?fit=${fit}` : ""}`);
  const { application, profile, settings, resume, letter, includeReferences, sections, letterDate } = await loadDocuments(id);
  const document = doc === "resume" ? resume : letter;
  if (!document) notFound();

  return (
    <>
      <style>{printCss(document.theme, settings.paper, fit)}</style>
      {doc === "resume" ? (
        <TailoredResume
          resume={document}
          profile={profile}
          paper={settings.paper}
          followThemeLayout={application.followThemeLayout}
          showPhoto={application.showPhoto}
          language={application.language}
          includeReferences={includeReferences}
          sections={sections}
          atsOrder={settings.atsReadingOrder}
          fit={fit}
        />
      ) : (
        <TailoredLetter
          letter={document}
          profile={profile}
          paper={settings.paper}
          company={application.company}
          location={application.location}
          tone={application.tone}
          date={letterDate}
          dateFormat={settings.dateFormat}
          language={application.language}
        />
      )}
    </>
  );
}

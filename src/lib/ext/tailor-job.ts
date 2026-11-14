import "server-only";

// Fork-only: "Save and tailor" from the extension. Reads the saved posting
// (what it asks for, and how the profile matches), keeps that on the
// application, then queues the resume and cover letter as the application
// page's own "Write the resume" does, so the page shows their progress.

import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting, matchRequirements } from "@/lib/ai/tasks";
import { defineJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { writeDocumentJob, writeDocumentJobKey, type WritableKind } from "@/lib/jobs/write-document";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

export const extTailorJobKey = (applicationId: string) => `ext-tailor:${applicationId}`;

export const extTailorJob = defineJob({
  type: "ext-tailor",
  input: z.object({ applicationId: z.string().min(1) }),
  result: z.object({ applicationId: z.string(), writing: z.array(z.enum([DocumentKind.RESUME, DocumentKind.COVER_LETTER])) }),
  async run({ applicationId }, { step, signal }) {
    await step("Reading the posting");
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { postingText: true, extracted: true, company: true, role: true, title: true, location: true, documents: { select: { kind: true } } },
    });
    if (!application) return { applicationId, writing: [] };

    if (!application.extracted && application.postingText.trim()) {
      const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
      const extraction = await extractPosting(provider, { posting: application.postingText }, { ...options, signal });
      await step("Matching it with your profile");
      const matching = await matchRequirements(provider, { requirements: extraction.data.requirements, profile }, { ...options, signal });
      const read = extraction.data;
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          extracted: read,
          extractedWith: extraction.promptVersion,
          match: matching.data,
          matchedWith: matching.promptVersion,
          // What the page said wins; the AI's reading fills what it didn't.
          company: application.company || read.company || "",
          role: application.role || read.role || "",
          location: application.location || read.location || "",
          ...(application.title ? {} : { title: [application.role || read.role, application.company || read.company].filter(Boolean).join(" · ") || "Untitled application" }),
        },
      });
    }

    const { documentsToWrite } = await loadSettings();
    const kinds: WritableKind[] = documentsToWrite === "resume" ? ["RESUME"] : documentsToWrite === "letter" ? ["COVER_LETTER"] : ["RESUME", "COVER_LETTER"];
    const writing: WritableKind[] = [];
    for (const kind of kinds) {
      if (application.documents.some((document) => document.kind === kind)) continue;
      const key = writeDocumentJobKey(applicationId, kind);
      if ((await findUnfinishedJobs(key)).length === 0) await startJob(writeDocumentJob, { applicationId, kind }, { key, applicationId });
      writing.push(kind);
    }
    return { applicationId, writing };
  },
});

import "server-only";

// Fork-only: the applications behind the extension's API. Saving a job,
// finding the application for the page the extension is on, how far its
// documents are, and marking it applied.

import { Prisma } from "@/generated/prisma/client";
import { ApplicationStatus, DocumentKind, JobStatus } from "@/generated/prisma/enums";
import { isAiConfigured } from "@/lib/ai/config";
import { startJob } from "@/lib/jobs/runner";
import { writeDocumentJobKey } from "@/lib/jobs/write-document";
import { prisma } from "@/lib/prisma";
import { statusInfo } from "@/lib/status";
import { applyStatusChange } from "@/lib/status-changes";

import { ExtError } from "./route";
import { extTailorJob, extTailorJobKey } from "./tailor-job";
import { jobKey, parseJobUrl } from "./url";

/** Where a document is: written, being written, failed to write, or not asked for. */
export type DocState = "ready" | "writing" | "failed" | "missing";

export type ExtApplication = {
  id: string;
  title: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  statusLabel: string;
  postingUrl: string;
  /** The application in Dossier. */
  path: string;
  resume: DocState;
  letter: DocState;
  archived: boolean;
};

const SELECT = { id: true, title: true, company: true, role: true, status: true, postingUrl: true, archivedAt: true, documents: { select: { kind: true } } } as const;
type Row = Prisma.ApplicationGetPayload<{ select: typeof SELECT }>;

async function docState(row: Row, kind: "RESUME" | "COVER_LETTER"): Promise<DocState> {
  if (row.documents.some((document) => document.kind === kind)) return "ready";
  const jobs = await prisma.job.findMany({
    where: { key: { in: [writeDocumentJobKey(row.id, kind), extTailorJobKey(row.id)] } },
    orderBy: { createdAt: "desc" },
    select: { key: true, status: true },
  });
  if (jobs.some((job) => job.status === JobStatus.QUEUED || job.status === JobStatus.RUNNING)) return "writing";
  return jobs[0]?.status === JobStatus.FAILED ? "failed" : "missing";
}

async function view(row: Row): Promise<ExtApplication> {
  const [resume, letter] = await Promise.all([docState(row, DocumentKind.RESUME), docState(row, DocumentKind.COVER_LETTER)]);
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    role: row.role,
    status: row.status,
    statusLabel: statusInfo(row.status).label,
    postingUrl: row.postingUrl,
    path: `/applications/${row.id}`,
    resume,
    letter,
    archived: row.archivedAt !== null,
  };
}

/**
 * The applications for the job at `url`, best first: the ones the extension
 * linked to it, and any whose posting link is the same job. Open ones before
 * archived, newest first. Empty for a list page or a job not saved.
 */
export async function findApplications(url: string): Promise<ExtApplication[]> {
  const key = jobKey(url);
  if (!key) return [];
  const linked = await prisma.extJobUrl.findMany({ where: { key }, select: { applicationId: true } });
  // Applications made in Dossier itself have only their posting link: single user, so reading them all is cheap.
  const withLinks = await prisma.application.findMany({ where: { postingUrl: { not: "" } }, select: { id: true, postingUrl: true } });
  const ids = new Set([...linked.map((row) => row.applicationId), ...withLinks.filter((row) => jobKey(row.postingUrl) === key).map((row) => row.id)]);
  if (ids.size === 0) return [];
  const rows = await prisma.application.findMany({ where: { id: { in: [...ids] } }, select: SELECT, orderBy: { createdAt: "desc" } });
  const views = await Promise.all(rows.map(view));
  return views.sort((a, b) => Number(a.archived) - Number(b.archived));
}

export async function getApplication(id: string): Promise<ExtApplication> {
  const row = await prisma.application.findUnique({ where: { id }, select: SELECT });
  if (!row) throw new ExtError("not-found", "That application is no longer in Dossier.");
  return view(row);
}

export type SaveInput = {
  url: string;
  sourceUrl?: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  tailor?: boolean;
};

export type SaveResult = { application: ExtApplication; existing: boolean; tailoring: "started" | "no-ai" | "off" };

/** Frees a key whose application was deleted (the link has no foreign key, to leave Application untouched). */
async function releaseOrphan(tx: Prisma.TransactionClient, key: string): Promise<void> {
  const link = await tx.extJobUrl.findUnique({ where: { key }, select: { id: true, applicationId: true } });
  if (link && !(await tx.application.findUnique({ where: { id: link.applicationId }, select: { id: true } }))) {
    await tx.extJobUrl.delete({ where: { id: link.id } });
  }
}

const clip = (text: string | undefined, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Saves the job at `url` as a Draft application, once: the same job saved
 * again (from its apply form, a Greenhouse embed, a second click) returns the
 * first application. With `tailor`, the resume and letter are written next.
 */
export async function saveFromExtension(input: SaveInput): Promise<SaveResult> {
  const parsed = parseJobUrl(input.url);
  if (!parsed) throw new ExtError("bad-request", "That isn't a web address.");
  if (parsed.kind === "list") throw new ExtError("bad-request", "This page lists many jobs. Open one job, then save it.");
  const [existing] = await findApplications(input.url);
  if (existing) return { application: existing, existing: true, tailoring: "off" };

  const source = input.sourceUrl ? parseJobUrl(input.sourceUrl) : null;
  const company = clip(input.company, 200);
  const role = clip(input.title, 200);
  const description = (input.description ?? "").trim().slice(0, 100_000);
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      await releaseOrphan(tx, parsed.key);
      if (source?.key) await releaseOrphan(tx, source.key);
      const application = await tx.application.create({
        data: {
          title: [role, company].filter(Boolean).join(" · ") || "Untitled application",
          company,
          role,
          location: clip(input.location, 200),
          postingUrl: parsed.canonical,
          postingText: description,
        },
        select: { id: true },
      });
      await tx.extJobUrl.create({ data: { applicationId: application.id, key: parsed.key, url: parsed.canonical, role: "posting" } });
      if (source?.key && source.key !== parsed.key && source.kind !== "list") {
        const taken = await tx.extJobUrl.findUnique({ where: { key: source.key }, select: { id: true } });
        if (!taken) await tx.extJobUrl.create({ data: { applicationId: application.id, key: source.key, url: source.canonical, role: "source" } });
      }
      return application.id;
    });
  } catch (error) {
    // Two saves of one job at once: the second finds the first's key taken.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const [first] = await findApplications(input.url);
      if (first) return { application: first, existing: true, tailoring: "off" };
    }
    throw error;
  }

  let tailoring: SaveResult["tailoring"] = "off";
  if (input.tailor) tailoring = await startTailoring(id);
  return { application: await getApplication(id), existing: false, tailoring };
}

/** Starts writing the documents an application doesn't have yet. */
export async function startTailoring(id: string): Promise<"started" | "no-ai"> {
  if (!(await isAiConfigured())) return "no-ai";
  const key = extTailorJobKey(id);
  const running = await prisma.job.findFirst({ where: { key, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
  if (!running) await startJob(extTailorJob, { applicationId: id }, { key, applicationId: id });
  return "started";
}

/** Links another URL of the same job (its application form, say) to an application, so lookups from there find it. */
export async function linkUrl(id: string, url: string): Promise<ExtApplication> {
  const application = await getApplication(id);
  const parsed = parseJobUrl(url);
  if (!parsed?.key || parsed.kind === "list") throw new ExtError("bad-request", "That page isn't one job, so it can't be linked.");
  await prisma.$transaction((tx) => releaseOrphan(tx, parsed.key));
  const taken = await prisma.extJobUrl.findUnique({ where: { key: parsed.key }, select: { applicationId: true } });
  if (taken && taken.applicationId !== id) throw new ExtError("conflict", "That page is already linked to another application.");
  if (!taken) await prisma.extJobUrl.create({ data: { applicationId: id, key: parsed.key, url: parsed.canonical, role: "form" } });
  return application;
}

/** Applied: a Draft moves to Sent, as Mark as sent does in Dossier; one further along stays where it is. */
export async function markApplied(id: string): Promise<{ application: ExtApplication; changed: boolean }> {
  const current = await getApplication(id);
  if (current.status !== ApplicationStatus.DRAFT) return { application: current, changed: false };
  const result = await applyStatusChange(prisma, id, ApplicationStatus.SENT);
  if (result.outcome === "not-found") throw new ExtError("not-found", "That application is no longer in Dossier.");
  return { application: await getApplication(id), changed: result.outcome === "changed" };
}

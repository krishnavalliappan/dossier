// Attaching a saved job's PDFs to the application form in the tab: which
// frame has the upload fields, fetching the PDFs from Dossier, and what to
// tell the person afterwards.

import { attachFiles, scanUploads, type AttachFile, type AttachResult, type UploadField } from "../../src/lib/ext/page/attach";
import { ApiError, call, type Config, type ExtApplication } from "./api";
import { chrome } from "./chrome";

export type FrameScan = { frameId: number; fields: UploadField[] };
export type Uploads = { blocked: boolean; frames: FrameScan[] };

/** The tab's file fields, frame by frame (a Greenhouse form embedded in a careers page is a frame of its own). */
export async function scanTab(tabId: number): Promise<Uploads> {
  let results: { frameId: number; result?: ReturnType<typeof scanUploads> }[];
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanUploads });
  } catch {
    // Some frame we can't read: the main one alone.
    try {
      results = await chrome.scripting.executeScript({ target: { tabId }, func: scanUploads });
    } catch {
      return { blocked: false, frames: [] };
    }
  }
  const blocked = results.some((frame) => frame.result?.blocked);
  return { blocked, frames: results.filter((frame) => frame.result && frame.result.fields.length > 0).map((frame) => ({ frameId: frame.frameId, fields: frame.result!.fields })) };
}

/** The frame with the resume field (the first, if a page has two forms), and whether it also takes a cover letter. */
export function target(uploads: Uploads): { frameId: number; resume: UploadField; letter?: UploadField } | null {
  for (const frame of uploads.frames) {
    const resume = frame.fields.find((field) => field.kind === "resume");
    if (resume) return { frameId: frame.frameId, resume, letter: frame.fields.find((field) => field.kind === "letter") };
  }
  return null;
}

/** "Jane Doe – Acme – Resume.pdf", from Dossier's Content-Disposition. */
function fileName(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain name.
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * One of the application's PDFs, checked to be one. Rendering can take a
 * while (Dossier fits the resume to one page), and a busy or just-started
 * renderer can fail once: that's tried again before saying so.
 */
async function fetchPdf(config: Config, app: ExtApplication, kind: AttachFile["kind"], onRetry?: () => void): Promise<AttachFile> {
  const path = `/applications/${app.id}/${kind === "resume" ? "resume" : "cover-letter"}.pdf`;
  let response: Response;
  try {
    response = await call(config, path, { timeoutMs: 120_000 });
  } catch (error) {
    if (!(error instanceof ApiError && (error.status >= 500 || error.code === "timeout"))) throw error;
    onRetry?.();
    response = await call(config, path, { timeoutMs: 120_000 });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const isPdf = bytes.length > 1000 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  if (!isPdf) throw new ApiError("bad-pdf", `Dossier sent something that isn't a PDF for the ${kind === "resume" ? "resume" : "cover letter"}. Download it from Dossier instead.`);
  return { kind, name: fileName(response, `${app.company || "Resume"}.pdf`), base64: base64(bytes) };
}

export type Attached = { results: AttachResult[]; submitHeld: number };

/** Fetches the PDFs the form takes and Dossier has, and puts them in. */
export async function attach(config: Config, tabId: number, app: ExtApplication, where: NonNullable<ReturnType<typeof target>>, onRetry?: () => void): Promise<Attached> {
  const kinds: AttachFile["kind"][] = ["resume", ...(where.letter && app.letter === "ready" ? (["letter"] as const) : [])];
  // One after the other: rendering a PDF is heavy for Dossier, and the resume may take a few renders to fit one page.
  const files: AttachFile[] = [];
  for (const kind of kinds) files.push(await fetchPdf(config, app, kind, onRetry));
  const [frame] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [where.frameId] }, func: attachFiles, args: [files] });
  if (!frame?.result) throw new ApiError("page-changed", "The page changed while attaching. Open the extension again.");
  if (frame.result.blocked) throw new ApiError("blocked", "The extension doesn't attach files on LinkedIn.");
  return { results: frame.result.results, submitHeld: frame.result.submitHeld };
}

/** What happened, in a line per file. */
export function describeAttached({ results, submitHeld }: Attached): { lines: string[]; ok: boolean } {
  const what = { resume: "resume", letter: "cover letter" };
  const lines = results.map((result) =>
    result.outcome === "attached"
      ? result.replaced
        ? `Replaced ${result.replaced} with ${result.name}.`
        : `Attached ${result.name}.`
      : result.outcome === "missing"
        ? `No ${what[result.kind]} field on this page any more.`
        : `The page didn't take the ${what[result.kind]}. Download it from Dossier and attach it yourself.`,
  );
  if (submitHeld) lines.push("The page tried to send the form while attaching; it was held back. Check the form before you submit it.");
  return { lines, ok: results.length > 0 && results.every((result) => result.outcome === "attached") && !submitHeld };
}

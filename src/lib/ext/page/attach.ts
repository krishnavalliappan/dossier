// Fork-only: the resume and cover letter into an application form's file
// fields, injected by the browser extension into each frame of the page
// (chrome.scripting.executeScript). Only these functions' source is
// injected, so each is self-contained: nothing from outside it.
//
// It replaces a file already attached (a resume another extension put in)
// rather than adding a second. It never clicks a button and never submits;
// while it attaches, the form's submit events are held back. It does nothing
// on LinkedIn (Easy Apply is never touched).

export type UploadKind = "resume" | "letter";

export type UploadField = {
  kind: UploadKind | "other";
  /** What the field is called on the page ("Resume/CV"). */
  label: string;
  /** The file it holds now, if any (a name only; the file itself isn't read). */
  attached: string;
};

export type Scan = { blocked: boolean; fields: UploadField[] };

/** The file fields of this frame and what each is for. */
export function scanUploads(): Scan {
  if (/(^|\.)linkedin\.com$/i.test(location.hostname)) return { blocked: true, fields: [] };
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
  const textOf = (el: Element | null) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "");
  // Its own label, else the nearest text before it in its group ("Resume/CV ✱" over an "Attach" button).
  const labelOf = (input: HTMLInputElement) => {
    const own = clean(input.getAttribute("aria-label")) || (input.id ? textOf(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) : "") || textOf(input.closest("label"));
    let node: Element | null = input;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      const group = node.parentElement?.querySelector("legend, h1, h2, h3, h4, label, [class*='label' i], [id*='label' i]");
      const text = group && !group.contains(input) ? textOf(group) : "";
      if (text && text.length <= 80 && !/^(attach|upload|browse|choose)/i.test(text)) return text;
    }
    return own;
  };
  const kindOf = (input: HTMLInputElement, label: string): UploadKind | "other" => {
    const hints = `${input.id} ${input.name} ${input.getAttribute("data-qa") ?? ""} ${input.getAttribute("data-automation-id") ?? ""} ${label}`.toLowerCase();
    if (/cover[\s_-]*letter|motivation|lettre/.test(hints)) return "letter";
    if (/r[ée]sum[ée]|\bcv\b|curriculum|file-upload-input-ref/.test(hints) && !/portfolio|transcript|photo|avatar/.test(hints)) return "resume";
    return "other";
  };
  const fields: UploadField[] = [];
  for (const input of document.querySelectorAll<HTMLInputElement>("input[type='file']")) {
    if (input.disabled) continue;
    const label = labelOf(input);
    fields.push({ kind: kindOf(input, label), label: label.slice(0, 120), attached: input.files?.[0]?.name ?? "" });
  }
  return { blocked: false, fields };
}

export type AttachFile = { kind: UploadKind; name: string; base64: string };

export type AttachResult = {
  kind: UploadKind;
  /** attached: the field holds our file; missing: no such field here; refused: the page didn't take it. */
  outcome: "attached" | "missing" | "refused";
  /** The file it held before, when ours replaced one. */
  replaced: string;
  name: string;
};

/** Puts each file into the first field of its kind. The scan's rules again, so it stands alone. */
export function attachFiles(files: AttachFile[]): { blocked: boolean; results: AttachResult[]; submitHeld: number } {
  if (/(^|\.)linkedin\.com$/i.test(location.hostname)) return { blocked: true, results: [], submitHeld: 0 };
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
  const textOf = (el: Element | null) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "");
  const labelOf = (input: HTMLInputElement) => {
    const own = clean(input.getAttribute("aria-label")) || (input.id ? textOf(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) : "") || textOf(input.closest("label"));
    let node: Element | null = input;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      const group = node.parentElement?.querySelector("legend, h1, h2, h3, h4, label, [class*='label' i], [id*='label' i]");
      const text = group && !group.contains(input) ? textOf(group) : "";
      if (text && text.length <= 80 && !/^(attach|upload|browse|choose)/i.test(text)) return text;
    }
    return own;
  };
  const kindOf = (input: HTMLInputElement): UploadKind | "other" => {
    const hints = `${input.id} ${input.name} ${input.getAttribute("data-qa") ?? ""} ${input.getAttribute("data-automation-id") ?? ""} ${labelOf(input)}`.toLowerCase();
    if (/cover[\s_-]*letter|motivation|lettre/.test(hints)) return "letter";
    if (/r[ée]sum[ée]|\bcv\b|curriculum|file-upload-input-ref/.test(hints) && !/portfolio|transcript|photo|avatar/.test(hints)) return "resume";
    return "other";
  };
  const shown = (el: Element) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0 && (el as HTMLElement).offsetWidth > 1;
  };

  // Held back while attaching: a page that submits when a field changes would otherwise send the form.
  let submitHeld = 0;
  const hold = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    submitHeld++;
  };
  window.addEventListener("submit", hold, true);
  setTimeout(() => window.removeEventListener("submit", hold, true), 2000);

  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[type='file']")].filter((input) => !input.disabled);
  const results: AttachResult[] = files.map((file) => {
    const input = inputs.find((candidate) => kindOf(candidate) === file.kind);
    if (!input) return { kind: file.kind, outcome: "missing", replaced: "", name: file.name };
    const replaced = input.files?.[0]?.name ?? "";
    try {
      const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], file.name, { type: "application/pdf", lastModified: Date.now() }));
      // Replaces what was there: one file, ours.
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // A hidden input under a drop zone (Workday): the zone listens for a drop. One that took the change already
      // shows the file, so the drop goes only to zones still showing no file of ours.
      const zone = shown(input) ? null : input.closest("[data-automation-id*='drop' i], [class*='drop' i], [data-testid*='drop' i]");
      if (zone && !textOf(zone).includes(file.name)) {
        for (const type of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }
      const ok = input.files?.length === 1 && input.files[0].name === file.name;
      return { kind: file.kind, outcome: ok ? "attached" : "refused", replaced: replaced === file.name ? "" : replaced, name: file.name };
    } catch {
      return { kind: file.kind, outcome: "refused", replaced: "", name: file.name };
    }
  });
  return { blocked: false, results, submitHeld };
}

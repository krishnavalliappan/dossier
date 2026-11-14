import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { attachFiles, scanUploads, type Scan } from "./attach";

/** Runs scanUploads as the extension does: its source alone, inside the page. (attachFiles needs a real browser's DataTransfer: e2e/ext/attach-check.ts.) */
function scan(html: string, url: string): Scan {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  return dom.window.eval(`(${scanUploads.toString()})()`) as Scan;
}
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");

describe("scanUploads", () => {
  it("are self-contained, so they run injected", () => {
    for (const fn of [scanUploads, attachFiles]) expect(fn.toString()).not.toMatch(/__name|__vite|require\(/);
  });

  it("tells a Greenhouse form's resume field from its cover letter's, though both buttons say Attach", () => {
    expect(scan(fixture("greenhouse-posting"), "https://job-boards.greenhouse.io/gitlab/jobs/8638232002").fields).toEqual([
      { kind: "resume", label: "Resume/CV*", attached: "" },
      { kind: "letter", label: "Cover Letter", attached: "" },
    ]);
  });

  it("finds Lever's resume upload", () => {
    expect(scan(fixture("lever-apply"), "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply").fields).toEqual([expect.objectContaining({ kind: "resume" })]);
  });

  it.each([
    ['<label for="f">Upload your CV</label><input id="f" type="file">', "resume"],
    ['<div data-automation-id="file-upload-drop-zone"><input data-automation-id="file-upload-input-ref" type="file"></div>', "resume"],
    ['<fieldset><legend>Motivation letter</legend><input type="file" name="doc"></fieldset>', "letter"],
    ['<label>Portfolio (resume samples welcome) <input type="file"></label>', "other"],
    ['<label>Profile photo <input type="file"></label>', "other"],
  ])("reads %s as %s", (html, kind) => {
    expect(scan(`<!doctype html><body><form>${html}</form></body>`, "https://acme.example/apply").fields[0]?.kind).toBe(kind);
  });

  it("does nothing on LinkedIn", () => {
    expect(scan('<!doctype html><body><input type="file" name="resume"></body>', "https://www.linkedin.com/jobs/view/1/")).toEqual({ blocked: true, fields: [] });
  });
});

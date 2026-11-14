// Fork-only. Renders the base resume as a PDF in every built-in theme, with
// and without Settings → ATS reading order, and checks what an ATS parser
// reads: the text order (pdf.js, as pdftotext reads the content stream),
// one page, no photo. Writes a table and a screenshot of each theme's preview.
//
//   1. A dev server with the demo data (yarn prisma db seed -- --demo) on BASE_URL
//   2. DATABASE_URL pointing at its SQLite file, DOSSIER_DEV_PASSWORD its password
//   3. yarn tsx e2e/ext/ats-check.ts
//
// Output in e2e/ext/out/ (ignored by git).

import { mkdirSync, writeFileSync } from "node:fs";

import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { extractImages, extractText, getDocumentProxy } from "unpdf";

import { BUILT_IN_THEMES } from "../../src/lib/themes";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.DOSSIER_DEV_PASSWORD ?? "dev-password";
const OUT = new URL("./out/", import.meta.url).pathname;
const db = new DatabaseSync((process.env.DATABASE_URL ?? "").replace(/^file:/, ""));

const setSetting = (key: string, value: string) =>
  db.prepare(`INSERT INTO "Setting" (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).run(key, value, Date.now());

/** Where each section's heading is in the extracted text: -1 when it isn't there. */
function positions(text: string) {
  // Letter-spaced headings ("S K I L L S") are found too, and reported separately.
  const at = (word: string) => text.search(new RegExp(`\\b${word.split("").join("\\s?")}\\b`, "i"));
  return { name: at("Jane Doe".replace(/ /g, "")), experience: at("Experience"), skills: at("Skills"), education: at("Education") };
}

/** Headings that came out letter by letter. */
const spaced = (text: string) => /(?:^|\n)(?:[A-Z] ){3,}[A-Z]/m.test(text);

/** The base resume's PDF; a dev server still compiling may drop the first tries. */
async function fetchPdf(page: import("playwright-core").Page) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.request.get(`${BASE}/api/pdf?doc=base`, { timeout: 120_000 });
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

type Row = { theme: string; layout: string; ats: boolean; pages: number; images: number; order: string; pass: boolean; why: string };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // One page is the norm in Canada: Settings → Fit to one page, as it would be set.
  setSetting("fitBaseResume", "true");
  const rows: Row[] = [];
  for (const theme of BUILT_IN_THEMES) {
    setSetting("baseThemeId", theme.id);
    for (const ats of [false, true]) {
      setSetting("atsReadingOrder", String(ats));
      const response = await fetchPdf(page);
      if (!response.ok()) throw new Error(`${theme.id}: ${response.status()} ${await response.text()}`);
      const bytes = new Uint8Array(await response.body());
      writeFileSync(`${OUT}${theme.id}${ats ? "-ats" : ""}.pdf`, bytes);
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      writeFileSync(`${OUT}${theme.id}${ats ? "-ats" : ""}.txt`, text);
      let images = 0;
      for (let n = 1; n <= pdf.numPages; n++) images += (await extractImages(pdf, n)).length;
      const at = positions(text);
      const order = (["experience", "skills", "education"] as const)
        .filter((key) => at[key] >= 0)
        .sort((a, b) => at[a] - at[b])
        .join(" → ");
      const problems = [
        at.experience < 0 ? "no Experience heading" : "",
        at.skills >= 0 && at.experience > at.skills ? "Skills before Experience" : "",
        at.name > 40 ? "name not first" : "",
        spaced(text) ? "letter-spaced headings" : "",
        pdf.numPages > 1 ? `${pdf.numPages} pages` : "",
        images > 0 ? "has a photo or image" : "",
      ].filter(Boolean);
      rows.push({ theme: theme.id, layout: theme.layout, ats, pages: pdf.numPages, images, order, pass: problems.length === 0, why: problems.join("; ") });
    }
    // The preview, to look at the polish: the same with the setting on or off.
    await page.goto(`${BASE}/resume`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}${theme.id}.png`, fullPage: false });
  }
  await browser.close();

  const table = [
    "| theme | layout | ATS order | pages | images | reading order | result |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.theme} | ${row.layout} | ${row.ats ? "on" : "off"} | ${row.pages} | ${row.images} | ${row.order} | ${row.pass ? "✅" : `❌ ${row.why}`} |`),
  ].join("\n");
  writeFileSync(`${OUT}ats-check.md`, `${table}\n`);
  console.log(table);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

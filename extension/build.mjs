// Builds the unpacked extension into extension/dist (load it at
// chrome://extensions → Load unpacked).
//
//   node extension/build.mjs          the extension
//   node extension/build.mjs --test   plus access to every site, for the Playwright checks (never for use)

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const test = process.argv.includes("--test");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "fonts"), { recursive: true });

await build({
  entryPoints: { background: join(here, "src/background.ts"), popup: join(here, "src/popup.ts"), options: join(here, "src/options.ts") },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome123",
  // No keepNames: readPage is injected by its source, and esbuild's __name helper wouldn't exist in the page.
  keepNames: false,
  minify: false,
  legalComments: "none",
  logLevel: "warning",
});

cpSync(join(here, "static"), dist, { recursive: true });
cpSync(join(here, "icons"), join(dist, "icons"), { recursive: true });
cpSync(join(here, "../src/fonts/geist/OFL.txt"), join(dist, "fonts/OFL.txt"));
for (const weight of ["Regular", "Medium", "SemiBold"]) cpSync(join(here, `../src/fonts/geist/Geist-${weight}.woff2`), join(dist, `fonts/Geist-${weight}.woff2`));

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
if (test) manifest.host_permissions = ["<all_urls>"];
writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// The injected function must stand alone (see readPage).
const popup = readFileSync(join(dist, "popup.js"), "utf8");
if (/__name\(/.test(popup)) throw new Error("popup.js uses esbuild's __name helper: readPage would fail in the page.");

console.log(`Built ${test ? "test " : ""}extension into ${dist}`);

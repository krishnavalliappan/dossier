// Fork-only. Loads the APPROVED bullets of a bullet bank into the profile
// (src/lib/ext/bank). A dry run unless --apply is given:
//
//   yarn tsx scripts/import-bank.ts ~/resume-kit/bullet-bank.md
//   yarn tsx scripts/import-bank.ts ~/resume-kit/bullet-bank.md --apply
//
// The bank file is private: keep it out of the repository.

import { readFileSync } from "node:fs";

import { createPrismaClient } from "../src/lib/database";
import { formatReport, importBank } from "../src/lib/ext/bank/apply";
import { parseBank } from "../src/lib/ext/bank/parse";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--apply");
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (unknown.length || files.length !== 1) {
    console.error("Usage: yarn tsx scripts/import-bank.ts <bullet-bank.md> [--apply]");
    process.exit(2);
  }
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  try {
    const report = await importBank(db, parseBank(readFileSync(files[0], "utf8")), { dryRun: !apply });
    console.log(formatReport(report, !apply));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

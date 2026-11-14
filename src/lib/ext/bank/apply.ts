// Fork-only: loads the APPROVED bullets of a bullet bank into the profile.
// Re-running it updates what changed and never duplicates: a bullet is keyed
// by its bank id, and a role's or project's bullets are rewritten from the
// bank as a whole. Only the roles and projects the bank fills are touched.

import type { PrismaClient } from "@/generated/prisma/client";

import { approvedBullets, claimKey, type BankBulletEntry, type ParsedBank, type Rejection } from "./parse";

export type TargetKind = "experience" | "project";
type Target = { kind: TargetKind; id: string; label: string };

export type ImportReport = {
  /** Approved bullets loaded, by role or project, in bank order. */
  targets: { kind: TargetKind; label: string; heading: string; ids: string[]; neutral: number }[];
  rejected: Rejection[];
  /** Headings with approved bullets that match no role or project on the profile. */
  unmatched: { heading: string; ids: string[] }[];
  blocked: number;
  /** Why the result is too thin to tailor from; empty when it's enough. */
  thin: string[];
  /** Rows written (or that would be, in a dry run). */
  changes: { upserted: number; removed: number; profileEntries: number };
};

/** Fewer approved bullets than this, overall, is too few to choose from. */
export const THIN_TOTAL = 8;
/** Fewer than this on a role or project leaves it nearly empty on the resume. */
export const THIN_PER_TARGET = 2;

const words = (text: string) => ` ${claimKey(text)} `;
const contains = (haystack: string, needle: string) => claimKey(needle).length > 0 && words(haystack).includes(words(needle));

/** The role or project a bank heading names: "Role @ Company" (any separator) or a project's name. */
export function matchHeading(heading: string, targets: readonly Target[], roles: readonly { id: string; role: string; company: string }[]): Target | undefined {
  if (!heading) return undefined;
  const byCompany = roles.filter((role) => contains(heading, role.company));
  const exact = byCompany.filter((role) => contains(heading, role.role));
  const role = exact.length === 1 ? exact[0] : byCompany.length === 1 ? byCompany[0] : undefined;
  if (role) return targets.find((target) => target.id === role.id);
  const projects = targets.filter((target) => target.kind === "project" && (claimKey(target.label) === claimKey(heading) || contains(heading, target.label)));
  return projects.length === 1 ? projects[0] : undefined;
}

/** The bullets a profile entry gets from the bank: the neutral wording, in bank order. */
export const profileBullets = (bullets: readonly Pick<BankBulletEntry, "variant" | "text">[]) =>
  bullets.filter((bullet) => bullet.variant === "neutral").map((bullet) => bullet.text).join("\n");

/**
 * Imports the bank's approved bullets. With `dryRun`, reports what it would
 * do and writes nothing. Bullets under a heading that matches nothing on the
 * profile are reported, never guessed into a role.
 */
export async function importBank(db: PrismaClient, bank: ParsedBank, { dryRun = false } = {}): Promise<ImportReport> {
  const { approved, rejected } = approvedBullets(bank);
  const [roles, projects, existing] = await Promise.all([
    db.experience.findMany({ select: { id: true, role: true, company: true }, orderBy: { sort: "asc" } }),
    db.project.findMany({ select: { id: true, name: true }, orderBy: { sort: "asc" } }),
    db.bankBullet.findMany({ select: { id: true, targetId: true, targetKind: true } }),
  ]);
  const targets: Target[] = [
    ...roles.map((role) => ({ kind: "experience" as const, id: role.id, label: `${role.role} @ ${role.company}` })),
    ...projects.map((project) => ({ kind: "project" as const, id: project.id, label: project.name })),
  ];

  const placed = new Map<string, { target: Target; heading: string; bullets: BankBulletEntry[] }>();
  const unmatched = new Map<string, string[]>();
  for (const bullet of approved) {
    const target = matchHeading(bullet.heading, targets, roles);
    if (!target) {
      unmatched.set(bullet.heading, [...(unmatched.get(bullet.heading) ?? []), bullet.id]);
      continue;
    }
    const entry = placed.get(target.id) ?? { target, heading: bullet.heading, bullets: [] };
    entry.bullets.push(bullet);
    placed.set(target.id, entry);
  }

  const keep = new Set([...placed.values()].flatMap((entry) => entry.bullets.map((bullet) => bullet.id)));
  const removed = existing.filter((row) => !keep.has(row.id));
  // Entries the bank filled before but no longer does are emptied, so a bullet taken back leaves the resume too.
  const emptied = [...new Set(removed.map((row) => row.targetId))].filter((id) => !placed.has(id) && targets.some((target) => target.id === id));

  const report: ImportReport = {
    targets: [...placed.values()].map(({ target, heading, bullets }) => ({
      kind: target.kind,
      label: target.label,
      heading,
      ids: bullets.map((bullet) => bullet.id),
      neutral: bullets.filter((bullet) => bullet.variant === "neutral").length,
    })),
    rejected,
    unmatched: [...unmatched].map(([heading, ids]) => ({ heading, ids })),
    blocked: bank.blocked.length,
    thin: thinness([...placed.values()].map(({ target, bullets }) => ({ label: target.label, neutral: bullets.filter((bullet) => bullet.variant === "neutral").length }))),
    changes: { upserted: keep.size, removed: removed.length, profileEntries: placed.size + emptied.length },
  };
  if (dryRun) return report;

  await db.$transaction(async (tx) => {
    if (removed.length) await tx.bankBullet.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
    let sort = 0;
    for (const { target, bullets } of placed.values()) {
      for (const bullet of bullets) {
        const data = { baseId: bullet.baseId, variant: bullet.variant, targetKind: target.kind, targetId: target.id, text: bullet.text, tier: bullet.tier, sort: sort++ };
        await tx.bankBullet.upsert({ where: { id: bullet.id }, create: { id: bullet.id, ...data }, update: data });
      }
      const text = profileBullets(bullets);
      if (target.kind === "experience") await tx.experience.update({ where: { id: target.id }, data: { bullets: text } });
      else await tx.project.update({ where: { id: target.id }, data: { bullets: text } });
    }
    for (const id of emptied) {
      const kind = existing.find((row) => row.targetId === id)?.targetKind;
      if (kind === "project") await tx.project.update({ where: { id }, data: { bullets: "" } });
      else await tx.experience.update({ where: { id }, data: { bullets: "" } });
    }
    await tx.bankClaimBlock.deleteMany();
    const phrases = [...new Set(bank.blocked.map((phrase) => phrase.trim()).filter(Boolean))];
    if (phrases.length) await tx.bankClaimBlock.createMany({ data: phrases.map((phrase) => ({ phrase })) });
  });
  return report;
}

function thinness(entries: { label: string; neutral: number }[]): string[] {
  const total = entries.reduce((sum, entry) => sum + entry.neutral, 0);
  const thin: string[] = [];
  if (total < THIN_TOTAL) thin.push(`Only ${total} approved bullet${total === 1 ? "" : "s"} reached the profile; tailoring needs at least ${THIN_TOTAL} to choose from.`);
  for (const entry of entries) {
    if (entry.neutral < THIN_PER_TARGET) thin.push(`${entry.label} has ${entry.neutral} approved bullet${entry.neutral === 1 ? "" : "s"}.`);
  }
  return thin;
}

/** The report as lines for the terminal. */
export function formatReport(report: ImportReport, dryRun: boolean): string {
  const lines = [dryRun ? "Dry run: nothing written. Pass --apply to write." : "Imported."];
  for (const target of report.targets) lines.push(`  ✓ ${target.label} ← ${target.ids.join(", ")}`);
  for (const entry of report.unmatched) lines.push(`  ? "${entry.heading}" matches no role or project: ${entry.ids.join(", ")} left out`);
  if (report.rejected.length) lines.push(`  ${report.rejected.length} not approved:`);
  for (const entry of report.rejected) lines.push(`    ✗ ${entry.id} (line ${entry.line}): ${entry.reason}`);
  lines.push(`  DO NOT CLAIM phrases: ${report.blocked}`);
  lines.push(`  bullets kept: ${report.changes.upserted}, removed: ${report.changes.removed}, profile entries rewritten: ${report.changes.profileEntries}`);
  for (const warning of report.thin) lines.push(`  ⚠ Too thin to tailor: ${warning}`);
  return lines.join("\n");
}

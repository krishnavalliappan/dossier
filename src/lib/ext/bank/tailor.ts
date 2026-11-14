// Fork-only: the bullet bank's part in writing a tailored resume or letter.
// Before the AI writes, healthtech postings get the bank's healthcare
// wording of each bullet (others keep the neutral wording already on the
// profile). After it writes, any sentence with a DO NOT CLAIM phrase is cut,
// whatever the AI was told: the list must never reach a document.

import type { Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import { blockedIn } from "./parse";

export type BankRow = { id: string; baseId: string; variant: string; targetId: string; text: string; sort: number };

// Words that mark a posting as healthtech. Two different ones are needed, so
// one passing mention ("health benefits") doesn't switch the wording.
const HEALTH_TERMS = [
  /\bhealth\s?(?:care|tech)\b/i,
  /\bpatients?\b/i,
  /\bclinic(?:s|al|ians?)?\b/i,
  /\bhospitals?\b/i,
  /\b(?:EHR|EMR|PHI|HIPAA|PHIPA|HL7|FHIR)\b/,
  /\bmedical\b/i,
  /\bnurs(?:e|es|ing)\b/i,
  /\bpharma(?:cy|ceutical)?\b/i,
  /\bphysicians?\b/i,
  /\bdigital health\b/i,
];

/** Whether a posting is for a healthtech company or product. */
export function isHealthtech(posting: string, company = ""): boolean {
  const text = `${company}\n${posting}`.replace(/\bhealth(?:\s|-)?(?:benefits|insurance|spending|and dental|& dental|, dental)\b/gi, "");
  return HEALTH_TERMS.filter((term) => term.test(text)).length >= 2;
}

/**
 * The profile with each bank-filled role's and project's bullets in the
 * wording this posting gets: the healthcare variant of a bullet where it has
 * one, for healthtech; the neutral wording otherwise. Entries the bank
 * doesn't fill are left as they are.
 */
export function withVariants(profile: ProfileData, rows: readonly BankRow[], healthtech: boolean): ProfileData {
  if (!healthtech || rows.length === 0) return profile;
  const byTarget = new Map<string, BankRow[]>();
  for (const row of [...rows].sort((a, b) => a.sort - b.sort)) byTarget.set(row.targetId, [...(byTarget.get(row.targetId) ?? []), row]);

  const bullets = (id: string, current: string) => {
    const own = byTarget.get(id);
    if (!own) return current;
    const bases = [...new Set(own.map((row) => row.baseId))];
    return bases
      .map((base) => {
        const variants = own.filter((row) => row.baseId === base);
        return (variants.find((row) => row.variant === "healthcare") ?? variants.find((row) => row.variant === "neutral"))?.text;
      })
      .filter((text): text is string => Boolean(text))
      .join("\n");
  };
  return {
    ...profile,
    experience: profile.experience.map((entry) => ({ ...entry, bullets: bullets(entry.id, entry.bullets) })),
    projects: profile.projects.map((entry) => ({ ...entry, bullets: bullets(entry.id, entry.bullets) })),
  };
}

/** Text without the sentences (or bullet lines) that say a blocked phrase. */
function withoutBlocked(text: string, blocked: readonly string[]): { text: string; cut: string[] } {
  const cut: string[] = [];
  const lines = text.split("\n").flatMap((line) => {
    if (!blockedIn(line, blocked)) return [line];
    const sentences = line.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [line];
    const kept = sentences.filter((sentence) => {
      const phrase = blockedIn(sentence, blocked);
      if (phrase) cut.push(phrase);
      return !phrase;
    });
    const rest = kept.join("").trim();
    // A phrase across sentences is still caught: then the whole line goes.
    if (rest && blockedIn(rest, blocked)) {
      cut.push(blockedIn(rest, blocked)!);
      return [];
    }
    return rest ? [rest] : [];
  });
  return { text: lines.join("\n"), cut };
}

/** The units with every DO NOT CLAIM phrase cut out, and what was cut. */
export function guardClaims(units: readonly Unit[], blocked: readonly string[]): { units: Unit[]; cut: string[] } {
  if (blocked.length === 0) return { units: [...units], cut: [] };
  const cut: string[] = [];
  const guarded = units.map((unit) => {
    const result = withoutBlocked(unit.text, blocked);
    cut.push(...result.cut);
    return result.cut.length ? { ...unit, text: result.text } : unit;
  });
  return { units: guarded, cut: [...new Set(cut)] };
}

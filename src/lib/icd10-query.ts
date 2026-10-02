/**
 * Pure helpers for diagnosis-picker queries. Client-safe on purpose: the
 * server search module imports the 1.2 MB ICD catalog, and pulling that into
 * a client bundle for one regexp would be absurd.
 */
import { toLatinTwins } from "@/lib/catalogs/search-fold";

const ICD_CODE = /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,3})?$/;

/**
 * Split a «G43.81 Мигрень с осложнением» style query into code + name.
 * Doctors who know a code the catalog lacks type exactly this shape; the
 * picker turns it into a one-click "use code + name" option. Null when the
 * first token is not code-shaped or there is no name after it.
 *
 * A code typed on the Russian layout («М54.5 Люмбаго», the М Cyrillic) reads
 * as the Latin code, as the search reads it (audit CT-16): the letters look
 * the same, and the option used not to appear at all. Only the code token is
 * folded; the name stays as typed.
 */
export function parseCodeNameQuery(
  raw: string,
): { code: string; name: string } | null {
  const m = raw.trim().match(/^(\S+)\s+(.{3,})$/);
  if (!m) return null;
  const code = toLatinTwins(m[1]!.toLowerCase()).toUpperCase();
  if (!ICD_CODE.test(code)) return null;
  return { code, name: m[2]!.trim() };
}

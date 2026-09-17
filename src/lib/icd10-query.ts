/**
 * Pure helpers for diagnosis-picker queries. Client-safe on purpose: the
 * server search module imports the 1.2 MB ICD catalog, and pulling that into
 * a client bundle for one regexp would be absurd.
 */

/**
 * Split a «G43.81 Мигрень с осложнением» style query into code + name.
 * Doctors who know a code the catalog lacks type exactly this shape; the
 * picker turns it into a one-click "use code + name" option. Null when the
 * first token is not code-shaped or there is no name after it.
 */
export function parseCodeNameQuery(
  raw: string,
): { code: string; name: string } | null {
  const m = raw
    .trim()
    .match(/^([A-Za-z][0-9]{2}(?:\.[0-9A-Za-z]{1,3})?)\s+(.{3,})$/);
  if (!m) return null;
  return { code: m[1]!.toUpperCase(), name: m[2]!.trim() };
}

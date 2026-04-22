/**
 * Return initials for a full name, safe to show on public screens.
 * "Иванов Иван Иванович" → "Иванов И. И."
 * Falls back gracefully on short / empty input.
 */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const [surname, ...rest] = parts;
  return `${surname} ${rest.map((p) => p[0]!.toUpperCase() + ".").join(" ")}`;
}

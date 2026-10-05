/**
 * The runtime half of postcss-legacy-colors.cjs: a clinic brand colour set
 * from the database (`--brand-primary` in the layouts' inline style) needs
 * its `-rgb` / `-a` companions too, or Chrome 109 (Windows 7 machines in
 * the clinic) tints soft surfaces with the default brand blue.
 */

/** «#2353ff» or «#25f» → «35 83 255»; null for anything else. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** The companions of one colour custom property, as declarations. */
export function legacyColorCompanions(prop: string, hex: string): string {
  const rgb = hexToRgbTriplet(hex);
  return rgb ? `${prop}-rgb: ${rgb};${prop}-a: 1;` : "";
}

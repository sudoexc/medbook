/**
 * Ф8 (TZ-smart-constructor) — карта тела.
 *
 * Одна и та же SVG-фигура рисуется в кабинете врача (React) и в печатном
 * заключении (server-side HTML string), поэтому силуэт живёт здесь как
 * статичная разметка: что врач отметил — то и напечатается. Координаты
 * точек нормированы 0..1 относительно viewBox.
 */

export const BODY_MAP_VIEWBOX = { width: 100, height: 200 } as const;

// Статичная константа — безопасна для dangerouslySetInnerHTML/шаблона.
export const BODY_SILHOUETTE_MARKUP = [
  `<ellipse cx="50" cy="17" rx="10.5" ry="12"/>`,
  `<rect x="45.5" y="27" width="9" height="8" rx="3"/>`,
  `<rect x="32" y="33" width="36" height="56" rx="10"/>`,
  `<rect x="33.5" y="86" width="33" height="16" rx="7"/>`,
  `<rect x="19.5" y="38" width="10" height="56" rx="5"/>`,
  `<rect x="70.5" y="38" width="10" height="56" rx="5"/>`,
  `<ellipse cx="24.5" cy="99" rx="4.5" ry="6"/>`,
  `<ellipse cx="75.5" cy="99" rx="4.5" ry="6"/>`,
  `<rect x="34.5" y="100" width="14" height="82" rx="7"/>`,
  `<rect x="51.5" y="100" width="14" height="82" rx="7"/>`,
  `<ellipse cx="41" cy="188" rx="7.5" ry="5"/>`,
  `<ellipse cx="58.5" cy="188" rx="7.5" ry="5"/>`,
].join("");

export type BodyMapPointLike = {
  x: number;
  y: number;
  view: "FRONT" | "BACK";
  label?: string | null;
};

/**
 * Печатная версия: фигура с пронумерованными пинами для одной проекции.
 * Номера сквозные по всему списку точек (legend печатается отдельно).
 */
export function renderBodyMapSvg(
  points: readonly BodyMapPointLike[],
  view: "FRONT" | "BACK",
  opts?: { heightPx?: number },
): string {
  const { width, height } = BODY_MAP_VIEWBOX;
  const heightPx = opts?.heightPx ?? 180;
  const widthPx = Math.round((heightPx * width) / height);
  const pins = points
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.view === view)
    .map((p) => {
      const cx = (p.x * width).toFixed(1);
      const cy = (p.y * height).toFixed(1);
      return (
        `<circle cx="${cx}" cy="${cy}" r="4.6" fill="#dc2626" stroke="#ffffff" stroke-width="1.1"/>` +
        `<text x="${cx}" y="${cy}" dy="2.4" text-anchor="middle" font-size="6.4" font-weight="700" fill="#ffffff">${p.n}</text>`
      );
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${width} ${height}" width="${widthPx}" height="${heightPx}" xmlns="http://www.w3.org/2000/svg">` +
    `<g fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.8">${BODY_SILHOUETTE_MARKUP}</g>` +
    pins +
    `</svg>`
  );
}

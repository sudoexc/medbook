/**
 * Colour fallbacks for old Chrome (owner report 05.10.2026).
 *
 * Some doctors work on Windows 7 machines, where Chrome stopped at version
 * 109. Tailwind v4 writes colours with `color-mix()` and `oklch()`, which
 * Chrome learned in 111. For an opacity utility such as `bg-success/10`
 * Tailwind emits a fallback without the opacity (`var(--success)`) and the
 * real value inside `@supports (color: color-mix(...))`, so on Chrome 109 a
 * soft green badge became solid green, and its green text vanished on it
 * (the active sidebar item, the queue status badges, counters).
 *
 * This plugin runs after Tailwind and only ADDS fallbacks; a browser that
 * knows `color-mix()` renders exactly what it rendered before.
 *
 *   1. Every custom property holding a plain colour (`--success: #16c784`,
 *      Tailwind's `--color-emerald-500: oklch(...)`) gets two siblings in
 *      the same rule: `--success-rgb: 22 199 132` and `--success-a: 1`.
 *      One that only points at another colour (`--primary:
 *      var(--brand-primary)`) points its siblings the same way, so a clinic
 *      brand colour set at runtime carries through.
 *   2. Each `@supports (color: color-mix(in lab, red, red))` block gets a
 *      twin under `@supports not (...)` right after it, with every value it
 *      can express without `color-mix()`:
 *      `color-mix(in oklab, var(--x) 10%, transparent)` becomes
 *      `rgb(var(--x-rgb) / calc(var(--x-a) * 10%))`, a literal colour mixed
 *      with transparent becomes its rgba(). What it cannot express (mixes of
 *      two variables, currentcolor) is left out, so the fallback before the
 *      block keeps applying, as it did.
 *   3. Gradients: Tailwind's `--tw-gradient-position: to right in oklab`
 *      gets a twin without the interpolation space, which old Chrome cannot
 *      parse (the logo tile lost its fill).
 *   4. Any other declaration with an `oklch()` colour or a convertible
 *      `color-mix()`: a normal property gets an rgba() copy in front of it
 *      (old Chrome drops the original it cannot parse and keeps the copy); a
 *      custom property, which old Chrome would accept as it is and fail on
 *      later, gets the converted value in a `@supports not` twin of its rule.
 *
 * Wired in postcss.config.mjs. Tests: tests/unit/postcss-legacy-colors.test.ts.
 */
"use strict";

const MIX_SUPPORTS = "(color: color-mix(in lab, red, red))";
const LEGACY_SUPPORTS = "not (color: color-mix(in lab, red, red))";
const MODERN = /\b(?:oklch|oklab|color-mix)\(/i;
// A gradient's colour interpolation space (Chrome 111+).
const INTERPOLATION =
  /\s*\bin\s+(?:oklab|oklch|srgb-linear|srgb|lab|lch|hsl|hwb|xyz-d50|xyz-d65|xyz|display-p3)(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/i;
// Minified output writes «(color:color-mix(in lab,red,red))».
const squash = (s) => String(s).replace(/\s+/g, "");

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function parseAlpha(raw) {
  if (raw == null || raw === "") return 1;
  const s = String(raw).trim();
  if (s.endsWith("%")) return clamp01(parseFloat(s) / 100);
  const n = parseFloat(s);
  return Number.isFinite(n) ? clamp01(n) : null;
}

/** oklch → sRGB 0..255, clipped to the sRGB gamut. */
function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055;
    return Math.round(clamp01(v) * 255);
  });
}

/**
 * A plain colour literal → { r, g, b, a }, or null. Hex, rgb()/rgba() and
 * oklch(); anything with var(), calc() or a keyword other than
 * white/black/transparent is not a plain colour.
 */
function parseColor(input) {
  const v = String(input).trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (v === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const ch = (x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    const a = parseAlpha(m[4]);
    if (a == null) return null;
    return { r: Math.round(ch(m[1])), g: Math.round(ch(m[2])), b: Math.round(ch(m[3])), a };
  }
  m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+|none)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const C = m[2].endsWith("%") ? (parseFloat(m[2]) / 100) * 0.4 : parseFloat(m[2]);
    const H = m[3] === "none" ? 0 : parseFloat(m[3]);
    const a = parseAlpha(m[4]);
    if (![L, C, H].every(Number.isFinite) || a == null) return null;
    const [r, g, b] = oklchToRgb(L, C, H);
    return { r, g, b, a };
  }
  return null;
}

function fmtAlpha(a) {
  return String(Math.round(a * 1000) / 1000);
}

function rgba({ r, g, b, a }) {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${fmtAlpha(a)})`;
}

/** The argument list of the function call opening at `start` (the "(" index). */
function readArgs(value, open) {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") {
      depth--;
      if (depth === 0) return { inner: value.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Split on top-level commas. */
function splitTop(inner) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * One `color-mix(...)` argument list → its legacy form, or null.
 * Only «colour P%, transparent» (in any space): mixing with transparent
 * keeps the colour and scales its alpha.
 */
function legacyMix(inner, colorVars) {
  const parts = splitTop(inner);
  if (parts.length !== 3 || !/^in\s+[a-z-]+$/i.test(parts[0])) return null;
  if (parts[2].toLowerCase() !== "transparent") return null;
  const m = /^(.*?)\s+([\d.]+)%$/.exec(parts[1]);
  if (!m) return null;
  const color = m[1].trim();
  const pct = parseFloat(m[2]);
  if (!Number.isFinite(pct)) return null;
  const vm = /^var\((--[\w-]+)\)$/.exec(color);
  if (vm) {
    if (!colorVars.has(vm[1])) return null;
    return `rgb(var(${vm[1]}-rgb) / calc(var(${vm[1]}-a) * ${pct}%))`;
  }
  const c = parseColor(color);
  if (!c) return null;
  return rgba({ ...c, a: c.a * (pct / 100) });
}

/**
 * The whole value with every color-mix() / oklch() it can express
 * replaced, or null when something modern would be left in it.
 */
function legacyValue(value, colorVars) {
  let out = "";
  let i = 0;
  const re = /\b(color-mix|oklch|oklab)\(/gi;
  let m;
  while ((m = re.exec(value))) {
    const open = m.index + m[0].length - 1;
    const call = readArgs(value, open);
    if (!call) return null;
    let replacement;
    if (m[1].toLowerCase() === "color-mix") replacement = legacyMix(call.inner, colorVars);
    else {
      const c = parseColor(value.slice(m.index, call.end));
      replacement = c ? rgba(c) : null;
    }
    if (replacement == null) return null;
    out += value.slice(i, m.index) + replacement;
    i = call.end;
    re.lastIndex = call.end;
  }
  out += value.slice(i);
  return out === value || MODERN.test(out) ? null : out;
}

function insideMixSupports(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && p.name === "supports" && /color-mix/i.test(p.params)) return true;
  }
  return false;
}

function pruneEmpty(container) {
  container.walk((n) => {
    if ((n.type === "rule" || n.type === "atrule") && n.nodes && n.nodes.length === 0) n.remove();
  });
  // A second sweep for parents emptied by the first.
  container.walk((n) => {
    if ((n.type === "rule" || n.type === "atrule") && n.nodes && n.nodes.length === 0) n.remove();
  });
}

function hasDecls(node) {
  let found = false;
  node.walkDecls(() => {
    found = true;
    return false;
  });
  return found;
}

const plugin = () => ({
  postcssPlugin: "medbook-legacy-colors",
  OnceExit(root, { AtRule }) {
    // 1. Which custom properties hold a colour.
    const colorVars = new Set();
    const isOwn = (prop) => prop.startsWith("--") && !prop.startsWith("--tw-");
    root.walkDecls((d) => {
      if (isOwn(d.prop) && parseColor(d.value)) colorVars.add(d.prop);
    });
    const refOf = (value) => /^var\((--[\w-]+)\)$/.exec(String(value).trim())?.[1] ?? null;
    for (let changed = true; changed; ) {
      changed = false;
      root.walkDecls((d) => {
        const ref = isOwn(d.prop) ? refOf(d.value) : null;
        if (ref && colorVars.has(ref) && !colorVars.has(d.prop)) {
          colorVars.add(d.prop);
          changed = true;
        }
      });
    }

    const siblingsFor = [];
    const copyBefore = [];
    const customByRule = new Map();
    const mixBlocks = [];
    root.walk((node) => {
      if (node.type === "atrule" && node.name === "supports" && squash(node.params) === squash(MIX_SUPPORTS)) {
        mixBlocks.push(node);
        return;
      }
      if (node.type !== "decl") return;
      if (colorVars.has(node.prop)) siblingsFor.push(node);
      // Gradients: «to bottom right in oklab» makes the whole gradient
      // invalid on old Chrome (the logo tile lost its fill); without the
      // interpolation space it falls back to the default sRGB blend.
      if (node.prop === "--tw-gradient-position" && INTERPOLATION.test(node.value)) {
        if (node.parent?.type !== "rule") return;
        const list = customByRule.get(node.parent) ?? [];
        list.push({ prop: node.prop, value: node.value.replace(INTERPOLATION, "").trim() || "to bottom" });
        customByRule.set(node.parent, list);
        return;
      }
      if (!MODERN.test(node.value) || insideMixSupports(node)) return;
      const legacy = legacyValue(node.value, colorVars);
      if (legacy == null) return;
      if (node.prop.startsWith("--")) {
        if (node.parent?.type !== "rule") return;
        const list = customByRule.get(node.parent) ?? [];
        list.push({ prop: node.prop, value: legacy });
        customByRule.set(node.parent, list);
      } else copyBefore.push({ node, value: legacy });
    });

    // A name can hold a colour in one rule and something else in another
    // (`initial`, a var() of a non-colour); only the colour ones get siblings.
    for (const d of siblingsFor) {
      const ref = refOf(d.value);
      const c = ref ? null : parseColor(d.value);
      if (ref && colorVars.has(ref)) {
        d.cloneAfter({ prop: `${d.prop}-a`, value: `var(${ref}-a)` });
        d.cloneAfter({ prop: `${d.prop}-rgb`, value: `var(${ref}-rgb)` });
      } else if (c) {
        d.cloneAfter({ prop: `${d.prop}-a`, value: fmtAlpha(c.a) });
        d.cloneAfter({ prop: `${d.prop}-rgb`, value: `${c.r} ${c.g} ${c.b}` });
      }
    }

    for (const { node, value } of copyBefore) node.cloneBefore({ value });

    for (const [rule, decls] of customByRule) {
      const twin = rule.clone({ nodes: [] });
      for (const { prop, value } of decls) twin.append({ prop, value });
      rule.after(new AtRule({ name: "supports", params: LEGACY_SUPPORTS, nodes: [twin] }));
    }

    // 2. The twin of every color-mix() @supports block.
    for (const block of mixBlocks) {
      const twin = block.clone({ params: LEGACY_SUPPORTS });
      twin.walkDecls((d) => {
        const legacy = MODERN.test(d.value) ? legacyValue(d.value, colorVars) : null;
        if (legacy == null) d.remove();
        else d.value = legacy;
      });
      pruneEmpty(twin);
      if (hasDecls(twin)) block.after(twin);
    }
  },
});
plugin.postcss = true;

module.exports = plugin;
module.exports.parseColor = parseColor;
module.exports.legacyValue = legacyValue;

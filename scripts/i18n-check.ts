#!/usr/bin/env tsx
/**
 * i18n-check: scan src/**\/*.{ts,tsx} for next-intl translation references and
 * compare against src/messages/{ru,uz}.json.
 *
 * Reports:
 *   - missing keys in ru.json
 *   - missing keys in uz.json
 *   - unused keys (declared but not referenced statically)
 *
 * Exit code:
 *   1 — if any missing keys in ru or uz
 *   0 — otherwise (unused keys are warnings only)
 *
 * Static analysis (regex-based, position-aware). Dynamic patterns like
 * `t(`types.${x}`)` are recognised for the literal prefix and any key starting
 * with `<ns>.<prefix>` is treated as referenced. Pure dynamic keys are skipped.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC_DIR = path.join(ROOT, "src");
const MESSAGES_DIR = path.join(SRC_DIR, "messages");

export type Diff = {
  missingInRu: string[];
  missingInUz: string[];
  unused: string[];
  referenced: string[];
  dynamicPrefixes: string[];
};

// ---------------------------------------------------------------------------
// JSON flatten
// ---------------------------------------------------------------------------

export function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (obj == null) return out;
  if (typeof obj !== "object") {
    if (prefix) out[prefix] = String(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, next, out);
    else out[next] = String(v ?? "");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source extraction (position-aware)
// ---------------------------------------------------------------------------

type Decl = {
  varName: string;
  ns: string;
  pos: number;
  /**
   * True when namespace itself contained `${...}`. In that case `ns` holds the
   * literal portion up to the first `${` (still useful as a dynamic prefix);
   * subsequent literal `t(...)` calls are NOT resolvable to a static key, so
   * we record them as dynamic prefixes only.
   */
  dynamicNs: boolean;
};

/**
 * Strategy:
 *   1. Find all `<varName> = use|getTranslations('<ns>')` declarations and
 *      record (varName, namespace, source position).
 *   2. For each call site `<varName>(...)`, attribute it to the *most recent*
 *      declaration of that varName that appears before the call. If no such
 *      declaration exists for `varName`, skip (the variable isn't a translator).
 *   3. Literal calls `<v>('foo.bar')` → `<ns>.foo.bar` (or just `foo.bar` if
 *      ns is empty).
 *   4. Template-literal calls `<v>(`prefix.${x}`)` with a non-empty literal
 *      prefix → register `<ns>.prefix` as a wildcard prefix.
 */
export function extractFromSource(source: string): {
  literalKeys: Set<string>;
  dynamicPrefixes: Set<string>;
} {
  const literalKeys = new Set<string>();
  const dynamicPrefixes = new Set<string>();

  // 1. Collect declarations.
  const decls: Decl[] = [];

  // (a) Static namespace: 'ns' or "ns" or empty.
  const staticDeclRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:use|get)Translations\s*\(\s*(?:(['"])([^'"]*)\2)?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticDeclRegex.exec(source)) !== null) {
    decls.push({ varName: m[1], ns: m[3] ?? "", pos: m.index, dynamicNs: false });
  }

  // (b) Template-literal namespace: `ns.${x}.something`. Capture literal
  // portion up to (but not including) the first `${`.
  const tplDeclRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:use|get)Translations\s*\(\s*\`([^\`]*?)\$\{[^\`]*\`\s*\)/g;
  while ((m = tplDeclRegex.exec(source)) !== null) {
    const literalPrefix = m[2].replace(/\.$/, ""); // drop trailing dot
    decls.push({ varName: m[1], ns: literalPrefix, pos: m.index, dynamicNs: true });
  }

  // (c) Template literal without placeholder: `ns` (effectively static).
  const tplStaticRegex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:use|get)Translations\s*\(\s*\`([^\`$]*)\`\s*\)/g;
  while ((m = tplStaticRegex.exec(source)) !== null) {
    decls.push({ varName: m[1], ns: m[2], pos: m.index, dynamicNs: false });
  }

  // Sort by position.
  decls.sort((a, b) => a.pos - b.pos);

  // Build per-variable list of (pos, ns) for fast lookup.
  const declsByVar = new Map<string, Decl[]>();
  for (const d of decls) {
    if (!declsByVar.has(d.varName)) declsByVar.set(d.varName, []);
    declsByVar.get(d.varName)!.push(d);
  }

  // 1.5. Detect function-parameter shadows. For each translator var, build
  // a list of byte-ranges [start, end] where it is shadowed by a function
  // parameter (destructured or positional). Calls within these ranges are
  // attributed to the shadowing param, NOT the outer const, and we skip them.
  const shadowRanges = new Map<string, Array<[number, number]>>();
  for (const varName of declsByVar.keys()) {
    const ranges = findShadowRanges(source, varName);
    if (ranges.length) shadowRanges.set(varName, ranges);
  }
  const isShadowed = (varName: string, pos: number): boolean => {
    const ranges = shadowRanges.get(varName);
    if (!ranges) return false;
    for (const [s, e] of ranges) if (pos >= s && pos <= e) return true;
    return false;
  };

  if (declsByVar.size === 0) return { literalKeys, dynamicPrefixes };

  // 2. Helper: find the declaration in scope for varName at byte offset.
  const declAt = (varName: string, offset: number): Decl | undefined => {
    const list = declsByVar.get(varName);
    if (!list) return undefined;
    let pick: Decl | undefined;
    for (const d of list) {
      if (d.pos < offset) pick = d;
      else break;
    }
    return pick;
  };

  // 3. For each known var, scan calls.
  for (const varName of declsByVar.keys()) {
    const escaped = escapeRe(varName);

    // Literal call: <var>('foo') or <var>("foo.bar")
    const litRegex = new RegExp(
      String.raw`(?<![\w$.])` + escaped + String.raw`\s*\(\s*(['"])([^'"]+)\1`,
      "g",
    );
    while ((m = litRegex.exec(source)) !== null) {
      const key = m[2];
      if (isShadowed(varName, m.index)) continue;
      const decl = declAt(varName, m.index);
      if (!decl) continue;
      const fullKey = decl.ns ? `${decl.ns}.${key}` : key;
      if (decl.dynamicNs) {
        // Namespace itself was dynamic — the literal portion + key is a
        // *prefix* under which any matching message-bundle key is "referenced".
        dynamicPrefixes.add(fullKey);
      } else {
        literalKeys.add(fullKey);
      }
    }

    // Template literal with leading literal: <var>(`prefix.${x}`)
    const tplRegex = new RegExp(
      String.raw`(?<![\w$.])` + escaped + String.raw`\s*\(\s*\`([^\`]*?)\$\{`,
      "g",
    );
    while ((m = tplRegex.exec(source)) !== null) {
      const prefix = m[1];
      if (!prefix) continue; // pure dynamic
      if (isShadowed(varName, m.index)) continue;
      const decl = declAt(varName, m.index);
      if (!decl) continue;
      dynamicPrefixes.add(decl.ns ? `${decl.ns}.${prefix}` : prefix);
    }
  }

  return { literalKeys, dynamicPrefixes };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find byte ranges where `varName` is shadowed by a function parameter.
 *
 * We look for patterns where `varName` appears inside a parenthesised
 * function-parameter list:
 *   - `function name(<params containing varName>) { ... }`
 *   - `(<params containing varName>) => ...` (arrow function — block or expr)
 *   - method shorthand `name(<params>) { ... }`
 *
 * `varName` may appear positional (`t: T`) or destructured (`{ a, t, b }`).
 *
 * For each match we return the range from the function body's start to its
 * matching brace (or the full arrow-expression for inline arrows). Calls to
 * `varName(...)` inside that range are treated as references to the param,
 * not the outer translator const.
 */
function findShadowRanges(source: string, varName: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // Find function-parameter lists. We scan for `(` and check if `varName`
  // appears (as an identifier) inside before the matching `)`. To avoid false
  // positives on calls like `foo(t)`, require the construct to be followed by
  // `=>` or `{` or `:` (return type) or whitespace then `{`.
  const re = /\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const open = m.index;
    const close = findMatching(source, open, "(", ")");
    if (close < 0) continue;
    const params = source.slice(open + 1, close);
    if (!hasIdentifier(params, varName)) continue;
    // Look ahead past whitespace + optional `:Type` for `{` or `=>`.
    let i = close + 1;
    while (i < source.length && /\s/.test(source[i])) i++;
    // Skip return-type annotation `: SomeType`
    if (source[i] === ":") {
      // crude skip until `{` or `=>` or newline-then-statement
      let depth = 0;
      while (i < source.length) {
        const c = source[i];
        if (c === "<" || c === "(" || c === "[") depth++;
        else if (c === ">" || c === ")" || c === "]") depth--;
        else if (depth === 0 && (c === "{" || (c === "=" && source[i + 1] === ">"))) break;
        i++;
      }
      while (i < source.length && /\s/.test(source[i])) i++;
    }
    const next = source.slice(i, i + 2);
    if (next === "=>") {
      // arrow function: body is either `{...}` or single expression up to
      // matching `,` / `)` / `;` / newline (heuristic — use to end of line for
      // expression form, or block form).
      let bodyStart = i + 2;
      while (bodyStart < source.length && /\s/.test(source[bodyStart])) bodyStart++;
      if (source[bodyStart] === "{") {
        const bodyEnd = findMatching(source, bodyStart, "{", "}");
        if (bodyEnd >= 0) out.push([bodyStart, bodyEnd]);
      } else {
        // Expression body — extend through the line. Cheap upper bound.
        let bodyEnd = bodyStart;
        let depth = 0;
        while (bodyEnd < source.length) {
          const c = source[bodyEnd];
          if (c === "(" || c === "{" || c === "[") depth++;
          else if (c === ")" || c === "}" || c === "]") {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (c === "," || c === ";" || c === "\n")) {
            break;
          }
          bodyEnd++;
        }
        out.push([bodyStart, bodyEnd]);
      }
    } else if (source[i] === "{") {
      const bodyStart = i;
      const bodyEnd = findMatching(source, bodyStart, "{", "}");
      if (bodyEnd >= 0) out.push([bodyStart, bodyEnd]);
    }
    // else: not a function — `(...)` was a call/grouping; ignore.
  }
  return out;
}

function findMatching(source: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let i = openIdx;
  let inStr: string | null = null;
  let inTpl = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inTpl) {
      if (c === "\\") { i++; continue; }
      if (c === "`") inTpl = false;
      // template-literal `${...}` interpolations are skipped here for
      // simplicity — adequate for our match.
      continue;
    }
    if (c === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (c === "'" || c === '"') { inStr = c; continue; }
    if (c === "`") { inTpl = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function hasIdentifier(haystack: string, name: string): boolean {
  // Strip strings & comments to avoid false matches; cheap enough for short
  // parameter lists.
  const cleaned = haystack
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  const re = new RegExp(String.raw`(?<![\w$])${escapeRe(name)}(?![\w$])`);
  return re.test(cleaned);
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    if (e.name === "messages") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export function computeDiff(args: {
  ruKeys: Set<string>;
  uzKeys: Set<string>;
  referenced: Set<string>;
  dynamicPrefixes: Set<string>;
}): Diff {
  const { ruKeys, uzKeys, referenced, dynamicPrefixes } = args;

  const isReferenced = (key: string): boolean => {
    if (referenced.has(key)) return true;
    for (const p of dynamicPrefixes) {
      if (key.startsWith(p)) return true;
    }
    return false;
  };

  const unionKeys = new Set([...ruKeys, ...uzKeys]);

  const missingInRu: string[] = [];
  const missingInUz: string[] = [];
  for (const key of referenced) {
    if (!ruKeys.has(key)) missingInRu.push(key);
    if (!uzKeys.has(key)) missingInUz.push(key);
  }

  const unused: string[] = [];
  for (const key of unionKeys) {
    if (!isReferenced(key)) unused.push(key);
  }

  missingInRu.sort();
  missingInUz.sort();
  unused.sort();

  return {
    missingInRu,
    missingInUz,
    unused,
    referenced: [...referenced].sort(),
    dynamicPrefixes: [...dynamicPrefixes].sort(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function loadMessages(file: string): Promise<Set<string>> {
  const raw = await fs.readFile(file, "utf-8");
  const json = JSON.parse(raw);
  return new Set(Object.keys(flatten(json)));
}

async function main(): Promise<number> {
  const ruFile = path.join(MESSAGES_DIR, "ru.json");
  const uzFile = path.join(MESSAGES_DIR, "uz.json");
  const [ruKeys, uzKeys] = await Promise.all([
    loadMessages(ruFile),
    loadMessages(uzFile),
  ]);

  const files = await walk(SRC_DIR);
  const referenced = new Set<string>();
  const dynamicPrefixes = new Set<string>();

  for (const file of files) {
    const src = await fs.readFile(file, "utf-8");
    const { literalKeys, dynamicPrefixes: dp } = extractFromSource(src);
    for (const k of literalKeys) referenced.add(k);
    for (const p of dp) dynamicPrefixes.add(p);
  }

  const diff = computeDiff({ ruKeys, uzKeys, referenced, dynamicPrefixes });

  const fmt = (arr: string[]) => arr.map((k) => `  - ${k}`).join("\n");

  // Cross-locale parity: keys present in only one bundle.
  const inRuNotUz = [...ruKeys].filter((k) => !uzKeys.has(k)).sort();
  const inUzNotRu = [...uzKeys].filter((k) => !ruKeys.has(k)).sort();

  console.log(`Scanned ${files.length} source files`);
  console.log(`Loaded ${ruKeys.size} ru keys, ${uzKeys.size} uz keys`);
  console.log(`Found ${referenced.size} literal references, ${dynamicPrefixes.size} dynamic prefixes`);
  console.log();

  if (inRuNotUz.length) {
    console.log(`PARITY: keys in ru.json missing from uz.json (${inRuNotUz.length}):`);
    console.log(fmt(inRuNotUz));
    console.log();
  }
  if (inUzNotRu.length) {
    console.log(`PARITY: keys in uz.json missing from ru.json (${inUzNotRu.length}):`);
    console.log(fmt(inUzNotRu));
    console.log();
  }

  if (diff.missingInRu.length) {
    console.log(`MISSING in ru.json (${diff.missingInRu.length}):`);
    console.log(fmt(diff.missingInRu));
    console.log();
  }
  if (diff.missingInUz.length) {
    console.log(`MISSING in uz.json (${diff.missingInUz.length}):`);
    console.log(fmt(diff.missingInUz));
    console.log();
  }
  if (diff.unused.length) {
    console.log(`UNUSED (warn only) (${diff.unused.length}):`);
    console.log(fmt(diff.unused.slice(0, 50)));
    if (diff.unused.length > 50) {
      console.log(`  … and ${diff.unused.length - 50} more`);
    }
    console.log();
  }

  const hasMissing =
    diff.missingInRu.length > 0 || diff.missingInUz.length > 0;
  const hasParityIssue = inRuNotUz.length > 0 || inUzNotRu.length > 0;

  if (!hasMissing && !hasParityIssue) {
    console.log("OK — no missing keys, locales in parity.");
    return 0;
  }
  return hasMissing || hasParityIssue ? 1 : 0;
}

const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(2);
    },
  );
}

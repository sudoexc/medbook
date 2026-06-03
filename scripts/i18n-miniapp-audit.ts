#!/usr/bin/env tsx
/**
 * i18n-miniapp-audit: scan src/app/c/[slug]/my/**\/*.{ts,tsx} for hardcoded
 * RU/UZ strings outside the _messages dict.
 *
 * Mini-app i18n is dict-based (`useT()` returns ruDict/uzDict), so the only
 * canonical place to keep localized strings is `_messages/{ru,uz}.ts`.
 * Anything else hardcoded in the surface is a regression.
 *
 * Detection rules:
 *   - Cyrillic letters (U+0400..U+04FF) inside a string literal → fail.
 *   - Lines that are comments (line-comment `//` or block-comment lines
 *     starting with `*`) are ignored.
 *   - Inline marker `// i18n-allow: <reason>` on the same line bypasses
 *     detection — used for DB-keyword matchers (e.g. `.includes("консульт")`).
 *
 * Files skipped:
 *   - `_messages/**` (the dict itself)
 *   - this script
 *
 * Exit code:
 *   1 — if any hardcoded literals found
 *   0 — clean
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MINIAPP_ROOT = path.join(ROOT, "src/app/c/[slug]/my");

const CYRILLIC = /[Ѐ-ӿ]/;
const ALLOW_MARKER = /\/\/\s*i18n-allow\b/;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;

type Finding = {
  file: string;
  line: number;
  literal: string;
  source: string;
};

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "_messages" || e.name === "node_modules") continue;
      await walk(full, out);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip block comments by replacing their interior with spaces, preserving
 * newlines so line numbers stay accurate.
 */
function stripBlockComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) {
        out += "  ";
        i += 2;
      }
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

function scanFile(file: string, raw: string): Finding[] {
  const sourceNoBlock = stripBlockComments(raw);
  const lines = sourceNoBlock.split("\n");
  const found: Finding[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (ALLOW_MARKER.test(line)) continue;
    const beforeComment = line.replace(/\/\/.*$/, "");
    STRING_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STRING_LITERAL.exec(beforeComment)) !== null) {
      const inner = m[2];
      if (CYRILLIC.test(inner)) {
        found.push({
          file,
          line: idx + 1,
          literal: m[0],
          source: line.trimEnd(),
        });
      }
    }
  }
  return found;
}

async function main(): Promise<void> {
  const files = await walk(MINIAPP_ROOT);
  files.sort();
  const allFindings: Finding[] = [];
  for (const file of files) {
    if (file.endsWith("scripts/i18n-miniapp-audit.ts")) continue;
    const raw = await fs.readFile(file, "utf8");
    allFindings.push(...scanFile(file, raw));
  }

  if (allFindings.length === 0) {
    process.stdout.write(
      `✓ mini-app i18n clean — ${files.length} files scanned, 0 hardcoded RU/UZ strings.\n`,
    );
    process.exit(0);
  }

  const grouped = new Map<string, Finding[]>();
  for (const f of allFindings) {
    const list = grouped.get(f.file) ?? [];
    list.push(f);
    grouped.set(f.file, list);
  }

  process.stderr.write(
    `✗ mini-app i18n audit — ${allFindings.length} hardcoded literal(s) in ${grouped.size} file(s):\n\n`,
  );
  for (const [file, list] of grouped) {
    const rel = path.relative(ROOT, file);
    process.stderr.write(`  ${rel}\n`);
    for (const f of list) {
      process.stderr.write(`    ${f.line}: ${f.literal}\n`);
      process.stderr.write(`        ${f.source}\n`);
    }
    process.stderr.write("\n");
  }
  process.stderr.write(
    "Fix by moving the literal into src/app/c/[slug]/my/_messages/{ru,uz}.ts and reading it via useT().\n" +
      "For DB-keyword matchers (e.g. `.includes(\"консульт\")`) add `// i18n-allow: matcher` to the line.\n",
  );
  process.exit(1);
}

void main();

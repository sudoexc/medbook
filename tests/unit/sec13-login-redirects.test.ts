/**
 * SEC-13: the staff login page lives only at src/app/login, outside the
 * [locale] segment. With next-intl `localePrefix: "as-needed"`, `/ru/login`
 * is rewritten to `/login`, but `/uz/login` resolves to [locale]=uz/login and
 * renders not-found. Every redirect or link to the login page must therefore
 * point at the bare `/login`.
 *
 * Guard: no non-comment line under src/app builds a locale-prefixed login
 * path, either from a template (`/${locale}/login`) or a literal (`/uz/login`).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(__dirname, "..", "..", "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const LOCALE_LOGIN = /\$\{[^}]*\}\/login\b|\/(?:ru|uz)\/login\b/;

describe("SEC-13 login redirects are locale-neutral", () => {
  it("the login page exists only outside [locale]", () => {
    expect(statSync(join(APP_DIR, "login", "page.tsx")).isFile()).toBe(true);
    expect(() => statSync(join(APP_DIR, "[locale]", "login"))).toThrow();
  });

  it("no source line under src/app points at a locale-prefixed /login", () => {
    const offenders: string[] = [];
    for (const file of walk(APP_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("{/*")
        ) {
          return;
        }
        if (LOCALE_LOGIN.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

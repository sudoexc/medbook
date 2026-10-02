/**
 * INF-13: .env.example is what an admin copies when moving or restoring the
 * server. It used to miss variables production depends on (SMTP, metrics
 * token, Telegram API base, exports bucket) and to carry dead ones
 * (BACKUP_BUCKET, ESKIZ_*, CRON_SECRET) plus a files.neurofax.uz URL that no
 * vhost serves.
 *
 * Guards:
 *   - the variables production needs are documented;
 *   - every variable the template defines is read somewhere in the repo, so
 *     a dead entry cannot creep back in;
 *   - a variable the template leaves empty is never read with `??` and a
 *     real default (or shell `${X-default}`): `cp .env.example .env` plus
 *     compose's env_file hands the app "", which `??` keeps. That is how the
 *     empty TELEGRAM_API_BASE= turned every Bot API call into
 *     fetch("/bot<token>/...").
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TELEGRAM_API_BASE,
  telegramApiBase,
} from "@/server/telegram/api-base";

const ROOT = join(__dirname, "..", "..");
const example = readFileSync(join(ROOT, ".env.example"), "utf8");
const keys = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
const emptyKeys = [...example.matchAll(/^([A-Z0-9_]+)=[ \t]*$/gm)].map(
  (m) => m[1],
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|sh|conf|yml)$/.test(name)) out.push(full);
  }
  return out;
}

function readSources(): { file: string; text: string }[] {
  return [
    ...walk(join(ROOT, "src")),
    ...walk(join(ROOT, "ops")),
    ...walk(join(ROOT, "scripts")),
    join(ROOT, "docker-compose.yml"),
  ].map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

// Read by Auth.js itself, never by our code.
const FRAMEWORK_READ = new Set(["AUTH_URL"]);

describe("INF-13 .env.example", () => {
  it("documents the variables production relies on", () => {
    for (const k of [
      "FIELD_ENCRYPTION_KEY",
      "DOCTOR_CABINET_ENABLED",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "METRICS_TOKEN",
      "TELEGRAM_API_BASE",
      "MINIO_EXPORTS_BUCKET",
      "ALERT_TG_TOKEN",
      "ALERT_TG_CHAT_ID",
      "BACKUP_DIR",
      "BACKUP_REMOTE",
    ]) {
      expect(keys, k).toContain(k);
    }
  });

  it("drops the stale entries", () => {
    for (const k of ["BACKUP_BUCKET", "CRON_SECRET", "ESKIZ_EMAIL"]) {
      expect(keys).not.toContain(k);
    }
    expect(example).not.toMatch(/files\.neurofax\.uz/);
    expect(example).not.toMatch(/there is no global bot token/);
  });

  it("every variable it defines is read somewhere in the repo", () => {
    const sources = readSources().map((f) => f.text).join("\n");
    const unused = keys.filter(
      (k) =>
        !FRAMEWORK_READ.has(k) && !new RegExp(`\\b${k}\\b`).test(sources),
    );
    expect(unused).toEqual([]);
  });

  it("a key it leaves empty is never read with ?? and a real default", () => {
    expect(emptyKeys).toContain("TELEGRAM_API_BASE");
    const offenders: string[] = [];
    for (const { file, text } of readSources()) {
      for (const k of emptyKeys) {
        // `?? ""` / `?? undefined` are fine: "" and the fallback mean the
        // same thing. Anything else must use `||` or a truthiness check.
        const js = new RegExp(
          `process\\.env(?:\\.${k}\\b|\\[["']${k}["']\\])\\s*\\?\\?(?!\\s*(?:""|''|undefined\\b|null\\b))`,
        );
        // Shell and compose: `${X-d}` / `${X=d}` apply d only when unset;
        // `${X:-d}` / `${X:=d}` also cover the empty value.
        const sh = new RegExp(`\\$\\{${k}[-=]`);
        if (js.test(text) || sh.test(text)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: ${k}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("INF-13 telegramApiBase", () => {
  it("treats empty and blank as the public endpoint", () => {
    expect(telegramApiBase("")).toBe(DEFAULT_TELEGRAM_API_BASE);
    expect(telegramApiBase("   ")).toBe(DEFAULT_TELEGRAM_API_BASE);
    expect(DEFAULT_TELEGRAM_API_BASE).toBe("https://api.telegram.org");
  });

  it("keeps a configured relay and drops trailing slashes", () => {
    expect(telegramApiBase("http://tg-internal:8081")).toBe(
      "http://tg-internal:8081",
    );
    expect(telegramApiBase(" https://medbook-tg.acc.workers.dev/ ")).toBe(
      "https://medbook-tg.acc.workers.dev",
    );
    expect(telegramApiBase("https://relay.example/tg//")).toBe(
      "https://relay.example/tg",
    );
    // The URL every Bot API call builds is absolute again.
    expect(() => new URL(`${telegramApiBase("")}/bot1:x/sendMessage`)).not.toThrow();
  });

  it("reads TELEGRAM_API_BASE from the environment by default", () => {
    const prev = process.env.TELEGRAM_API_BASE;
    try {
      delete process.env.TELEGRAM_API_BASE;
      expect(telegramApiBase()).toBe(DEFAULT_TELEGRAM_API_BASE);
      process.env.TELEGRAM_API_BASE = "";
      expect(telegramApiBase()).toBe(DEFAULT_TELEGRAM_API_BASE);
      process.env.TELEGRAM_API_BASE = "https://tg-proxy.example/";
      expect(telegramApiBase()).toBe("https://tg-proxy.example");
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_API_BASE;
      else process.env.TELEGRAM_API_BASE = prev;
    }
  });

  it("every Telegram call site goes through the helper", () => {
    for (const f of [
      "src/server/telegram/send.ts",
      "src/server/telegram/bot-api.ts",
      "src/app/api/crm/integrations/tg/set-webhook/route.ts",
      "src/app/api/crm/integrations/tg/webhook-status/route.ts",
    ]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      expect(text, f).toMatch(/telegramApiBase\(\)/);
      expect(text, f).not.toMatch(/process\.env\.TELEGRAM_API_BASE/);
    }
  });
});

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
 *     a dead entry cannot creep back in.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const example = readFileSync(join(ROOT, ".env.example"), "utf8");
const keys = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|sh|conf|yml)$/.test(name)) out.push(full);
  }
  return out;
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
    const sources = [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "ops")),
      ...walk(join(ROOT, "scripts")),
      join(ROOT, "docker-compose.yml"),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = keys.filter(
      (k) =>
        !FRAMEWORK_READ.has(k) && !new RegExp(`\\b${k}\\b`).test(sources),
    );
    expect(unused).toEqual([]);
  });
});

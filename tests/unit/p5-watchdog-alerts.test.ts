/**
 * Review of audit INF-01 / INF-03 (ops/watchdog.sh), pinned by running the
 * real script against stubbed `curl`, `openssl` and `timeout`.
 *
 * 1. The watchdog kept one ok/bad state. Since workers can be "degraded" for
 *    24h (a single DEAD outbox row) and a certificate warning lasts 14 days, a
 *    soft problem flipped the state to bad and a later real outage (HTTP 503)
 *    sent nothing. The state now holds the set of problems the operator was
 *    told about; any change of that set alerts (new, escalated, partly or
 *    fully recovered), an unchanged set stays quiet.
 * 2. The alert was one curl to a hard-coded api.telegram.org with the result
 *    ignored, and the state flipped anyway: one lost request lost the whole
 *    outage. It now honours ALERT_TG_API_BASE / TELEGRAM_API_BASE and
 *    ALERT_TG_PROXY, retries with backoff, counts only "ok":true, and writes
 *    the state only after delivery, so the next run sends it again.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../ops/watchdog.sh");
const TOKEN = "123456:SECRET-token";
// Each test spawns bash a few times (about 1s); a busy machine needs headroom.
const SPAWN_TIMEOUT_MS = 30_000;

let work: string;
let appDir: string;
let stubDir: string;
let statePath: string;

function stub(name: string, body: string) {
  const p = path.join(stubDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}`);
  chmodSync(p, 0o755);
}

/** Next /api/health answer the stubbed curl gives. */
function health(code: string, checks?: Record<string, string>) {
  const body = checks
    ? JSON.stringify({
        status: "x",
        checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { status: v }])),
      })
    : "";
  writeFileSync(path.join(work, "health.body"), body);
  writeFileSync(path.join(work, "health.code"), code);
}
const ALL_OK = { db: "ok", redis: "ok", minio: "ok", workers: "ok" };

/** Queue Telegram answers, one per send attempt; NETFAIL = curl error. */
function tgAnswers(...answers: string[]) {
  writeFileSync(path.join(work, "tg.answers"), answers.map((a) => `${a}\n`).join(""));
}

function cert(out: string) {
  writeFileSync(path.join(work, "cert.out"), out);
}

type Run = { status: number | null; log: string };
function run(env: Record<string, string> = {}): Run {
  const r = spawnSync("bash", [path.join(appDir, "ops", "watchdog.sh")], {
    cwd: appDir,
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${stubDir}:/usr/bin:/bin`,
      HOME: work,
      WATCHDOG_URL: "https://neurofax.test/api/health",
      WATCHDOG_STATE: statePath,
      WATCHDOG_DISK_STATE: path.join(work, "disk.state"),
      WATCHDOG_TG_BACKOFF: "0",
      WATCHDOG_CERT_HOSTS: "neurofax.test",
      ALERT_TG_TOKEN: TOKEN,
      ALERT_TG_CHAT_ID: "42",
      ...env,
    },
  });
  return { status: r.status, log: `${r.stdout}${r.stderr}` };
}

/** Every Telegram send attempt so far: its argv, and the message text. */
function sends(): { argv: string[]; text: string }[] {
  const file = path.join(work, "tg.calls");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n@@END@@\n")
    .filter((c) => c.trim() !== "")
    .map((c) => {
      const argv = c.split("\n@@ARG@@\n");
      const text = argv.find((a) => a.startsWith("text="))?.slice(5) ?? "";
      return { argv, text };
    });
}
const texts = () => sends().map((s) => s.text);
const state = () => (existsSync(statePath) ? readFileSync(statePath, "utf8") : null);

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "medbook-watchdog-"));
  appDir = path.join(work, "app");
  stubDir = path.join(work, "bin");
  statePath = path.join(work, "watchdog.state");
  mkdirSync(path.join(appDir, "ops"), { recursive: true });
  mkdirSync(stubDir);
  copyFileSync(SCRIPT, path.join(appDir, "ops", "watchdog.sh"));

  // curl: a sendMessage call records its argv and answers from the queue
  // (empty queue = delivered); anything else is the health probe.
  stub(
    "curl",
    [
      'case "$*" in',
      "  *sendMessage*)",
      `    first=1; for a in "$@"; do [ $first = 1 ] || printf '\\n@@ARG@@\\n' >> "${work}/tg.calls"; first=0; printf '%s' "$a" >> "${work}/tg.calls"; done`,
      `    printf '\\n@@END@@\\n' >> "${work}/tg.calls"`,
      `    ans=$(head -1 "${work}/tg.answers" 2>/dev/null)`,
      `    if [ -s "${work}/tg.answers" ]; then sed '1d' "${work}/tg.answers" > "${work}/tg.rest"; mv "${work}/tg.rest" "${work}/tg.answers"; fi`,
      '    [ -z "$ans" ] && ans=\'{"ok":true,"result":{"message_id":1}}\'',
      '    if [ "$ans" = NETFAIL ]; then echo "curl: (28) Connection timed out after 15000 milliseconds" >&2; exit 28; fi',
      "    printf '%s' \"$ans\"; exit 0 ;;",
      "esac",
      `cat "${work}/health.body"; printf '\\n%s' "$(cat "${work}/health.code")"`,
      "",
    ].join("\n"),
  );
  stub(
    "openssl",
    [
      'if [ "$1" = s_client ]; then cat > /dev/null; echo CERT; exit 0; fi',
      `cat > /dev/null; cat "${work}/cert.out"`,
      "",
    ].join("\n"),
  );
  stub("timeout", 'shift; exec "$@"\n');
  // The disk alert (CD-04) has its own state: a roomy disk keeps it quiet,
  // whatever the machine running the tests has left.
  stub("df", "printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/sda1 100 10 90 10%% /\\n'\n");
  cert("Certificate will not expire");
  health("200", ALL_OK);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("a standing soft problem no longer swallows a hard outage", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("degraded workers, then HTTP 503, then back: one message per change, none while unchanged", () => {
    health("200", { ...ALL_OK, workers: "degraded" });
    run();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(/^🟠 NeuroFax: сайт работает, но есть сбой\n• workers: degraded\n/);
    expect(state()).toContain("soft|workers:degraded|workers: degraded");

    run();
    expect(texts()).toHaveLength(1);

    // The acceptance scenario: Postgres dies while the soft alert stands.
    health("503", { ...ALL_OK, db: "down" });
    run();
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toMatch(
      /^🔴 NeuroFax: сайт не работает\nНовое:\n• HTTP 503\nОстаётся:\n• workers: degraded\n/,
    );
    expect(texts()[1]).toContain("Проверить: ssh");

    // A different code (or no answer) is the same outage.
    health("000");
    run();
    expect(texts()).toHaveLength(2);

    health("200", { ...ALL_OK, workers: "degraded" });
    run();
    expect(texts()).toHaveLength(3);
    expect(texts()[2]).toMatch(
      /^🟠 NeuroFax: сайт работает, но есть сбой\nПрошло:\n• HTTP 503\nОстаётся:\n• workers: degraded\n/,
    );

    health("200", ALL_OK);
    run();
    expect(texts()).toHaveLength(4);
    expect(texts()[3]).toMatch(/^✅ NeuroFax снова в порядке\nПрошло:\n• workers: degraded\n/);
    expect(state()).toBe("ok\n");

    run();
    expect(texts()).toHaveLength(4);
  });

  it("workers degraded (an old DEAD row), then down (no worker): the escalation alerts", () => {
    health("200", { ...ALL_OK, workers: "degraded" });
    run();
    health("200", { ...ALL_OK, workers: "down" });
    run();
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toContain("Новое:\n• workers: down\nПрошло:\n• workers: degraded");
  });

  it("a timeout and a down of the same subsystem are one problem", () => {
    health("200", { ...ALL_OK, redis: "down" });
    run();
    health("200", { ...ALL_OK, redis: "timeout" });
    run();
    expect(texts()).toHaveLength(1);
  });

  it("a certificate inside its 14 days, then an outage: both alert", () => {
    cert("Certificate will expire");
    run();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("• TLS neurofax.test: истекает менее чем через 14 дн.");

    health("502");
    run();
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toMatch(/^🔴 NeuroFax: сайт не работает\nНовое:\n• HTTP 502\nОстаётся:\n• TLS neurofax\.test/);
  });

  it("a state file from the old ok/bad watchdog: recovery still announced, a problem listed once", () => {
    writeFileSync(statePath, "bad\n");
    run();
    expect(texts()).toEqual([expect.stringMatching(/^✅ NeuroFax снова в порядке\n\d{4}-/)]);
    expect(state()).toBe("ok\n");

    writeFileSync(statePath, "bad\n");
    health("200", { ...ALL_OK, minio: "down" });
    run();
    expect(texts()[1]).toMatch(/^🟠 NeuroFax: сайт работает, но есть сбой\n• minio: down\n/);
  });

  it("new alert text carries no dashes", () => {
    health("200", { ...ALL_OK, workers: "degraded" });
    run();
    health("503");
    run();
    health("200", ALL_OK);
    run();
    expect(texts()).toHaveLength(3);
    for (const t of texts()) expect(t).not.toMatch(/[—–]/);
  });
});

describe("the alert is delivered or retried, never assumed", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it("retries a failed send and counts only an ok:true answer", () => {
    tgAnswers("NETFAIL", "<html>502 Bad Gateway</html>", '{"ok":true,"result":{}}');
    health("503");
    const r = run();
    expect(sends()).toHaveLength(3);
    expect(r.log).toContain("alert attempt 1/5 failed: curl: (28)");
    expect(r.log).toContain("alert attempt 2/5 failed: <html>502 Bad Gateway</html>");
    expect(state()).toContain("hard|http|HTTP 503");
  });

  it("all attempts failed: logged, state kept, and the next run sends the same transition", () => {
    tgAnswers("NETFAIL", "NETFAIL", "NETFAIL");
    health("503");
    const r = run({ WATCHDOG_TG_ATTEMPTS: "3" });
    expect(sends()).toHaveLength(3);
    expect(r.log).toContain("alert NOT delivered");
    expect(state()).toBeNull();

    run({ WATCHDOG_TG_ATTEMPTS: "3" });
    expect(sends()).toHaveLength(4);
    expect(texts()[3]).toMatch(/^🔴 NeuroFax: сайт не работает\n• HTTP 503\n/);
    expect(state()).toContain("hard|http|HTTP 503");
  });

  it("a failed recovery message is not lost either", () => {
    writeFileSync(statePath, "hard|http|HTTP 503\n");
    tgAnswers("NETFAIL");
    run({ WATCHDOG_TG_ATTEMPTS: "1" });
    expect(state()).toBe("hard|http|HTTP 503\n");
    run({ WATCHDOG_TG_ATTEMPTS: "1" });
    expect(texts()[1]).toMatch(/^✅ NeuroFax снова в порядке\nПрошло:\n• HTTP 503\n/);
    expect(state()).toBe("ok\n");
  });

  it("a 4xx (bad token, unknown chat) is not retried, and the token never reaches the log", () => {
    tgAnswers(`{"ok":false,"error_code":400,"description":"Bad Request: chat not found ${TOKEN}"}`);
    health("503");
    const r = run();
    expect(sends()).toHaveLength(1);
    expect(r.log).toContain("Bad Request: chat not found");
    expect(r.log).not.toContain(TOKEN);
    expect(state()).toBeNull();
  });

  it("a 429 is retried", () => {
    tgAnswers('{"ok":false,"error_code":429,"description":"Too Many Requests"}');
    health("503");
    run();
    expect(sends()).toHaveLength(2);
    expect(state()).not.toBeNull();
  });

  it("goes through ALERT_TG_PROXY and the app's TELEGRAM_API_BASE from .env", () => {
    writeFileSync(path.join(appDir, ".env"), "TELEGRAM_API_BASE=https://tg-proxy.example/\n");
    health("503");
    run({ ALERT_TG_PROXY: "socks5h://127.0.0.1:40000" });
    const { argv } = sends()[0]!;
    expect(argv).toContain(`https://tg-proxy.example/bot${TOKEN}/sendMessage`);
    const i = argv.indexOf("--proxy");
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe("socks5h://127.0.0.1:40000");
    expect(argv).toContain("chat_id=42");
  });

  it("ALERT_TG_API_BASE wins over TELEGRAM_API_BASE; no proxy flag when none is set", () => {
    writeFileSync(path.join(appDir, ".env"), "TELEGRAM_API_BASE=http://tg-internal:8081\n");
    health("503");
    run({ ALERT_TG_API_BASE: "https://api.telegram.org" });
    const { argv } = sends()[0]!;
    expect(argv).toContain(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(argv).not.toContain("--proxy");
  });

  it("without ALERT_TG_* nothing is sent, the log says so, and the state still follows", () => {
    health("503");
    const r = run({ ALERT_TG_TOKEN: "", ALERT_TG_CHAT_ID: "" });
    expect(sends()).toHaveLength(0);
    expect(r.log).toContain("alert not sent (ALERT_TG_TOKEN / ALERT_TG_CHAT_ID unset)");
    expect(state()).toContain("hard|http|HTTP 503");
  });
});

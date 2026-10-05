/**
 * Audit INF-08: ops/backup.sh saved the dump and the clinic files but not what
 * a restore needs besides them. FIELD_ENCRYPTION_KEY and APP_SECRET live only
 * in .env, so after losing the server the restored dump could not decrypt
 * passports, patient notes, SOAP drafts, 2FA secrets or clinic bot tokens,
 * and the production compose / nginx (neighbours' vhosts) / _deploy.sh were
 * on that box only.
 *
 * Pinned by running the real script against stubbed `docker` and `gpg`:
 *   - with BACKUP_PASSPHRASE or BACKUP_GPG_RECIPIENT the kit is written, and
 *     only as gpg output (the plaintext never lands next to the dump; the
 *     passphrase never appears on a command line);
 *   - it carries .env, docker-compose.yml, nginx.conf, conf.d and _deploy.sh;
 *   - without either variable nothing is written and the log says so loudly.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../ops/backup.sh");
const SECRET_MARKER = "FIELD_ENCRYPTION_KEY=marker-key-7f3a";

let work: string;
let appDir: string;
let backupDir: string;
let stubDir: string;

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "medbook-backup-"));
  appDir = path.join(work, "app");
  backupDir = path.join(work, "backups");
  stubDir = path.join(work, "bin");
  mkdirSync(path.join(appDir, "nginx", "conf.d"), { recursive: true });
  mkdirSync(stubDir);
  writeFileSync(
    path.join(appDir, ".env"),
    [SECRET_MARKER, "APP_SECRET=app-secret-marker", "MINIO_ACCESS_KEY=k", "MINIO_SECRET_KEY=s", ""].join("\n"),
  );
  writeFileSync(path.join(appDir, "docker-compose.yml"), "name: medbook\n");
  writeFileSync(path.join(appDir, "nginx", "nginx.conf"), "http {}\n");
  writeFileSync(path.join(appDir, "nginx", "conf.d", "rtxshop.conf"), "server {}\n");
  writeFileSync(path.join(appDir, "_deploy.sh"), "#!/bin/sh\n");

  // docker: pg_dump emits incompressible bytes (the size check wants >10 KB),
  // everything else succeeds silently.
  stub(
    "docker",
    `case "$*" in *pg_dump*) head -c 40000 /dev/urandom ;; esac\nexit 0\n`,
  );
  // gpg: records its argv and fd 3, and writes stdin as hex, so a plaintext
  // marker can only reach the backup folder if the script bypasses gpg.
  stub(
    "gpg",
    [
      `printf '%s\\n' "$@" > "${work}/gpg.argv"`,
      `if [ -e /dev/fd/3 ]; then cat <&3 > "${work}/gpg.fd3"; fi`,
      'out=""; prev=""',
      'for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done',
      'od -An -v -tx1 > "$out"',
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function stub(name: string, body: string) {
  const p = path.join(stubDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}`);
  chmodSync(p, 0o755);
}

function runBackup(extraEnv: Record<string, string>) {
  const res = spawnSync("bash", [SCRIPT], {
    cwd: appDir,
    encoding: "utf8",
    // A clean environment: nothing from this shell (a real BACKUP_* or
    // MINIO_* variable) may leak into the run.
    env: {
      NODE_ENV: "test",
      PATH: `${stubDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: work,
      BACKUP_DIR: backupDir,
      ...extraEnv,
    },
  });
  return { ...res, log: `${res.stdout}\n${res.stderr}` };
}

function backupFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (existsSync(backupDir)) walk(backupDir);
  return out;
}

function noPlaintextSecrets() {
  for (const f of backupFiles()) {
    const raw = readFileSync(f);
    expect(raw.includes(Buffer.from("marker-key-7f3a")), f).toBe(false);
    expect(raw.includes(Buffer.from("app-secret-marker")), f).toBe(false);
  }
}

function kitMembers(kit: string): string[] {
  const hex = readFileSync(kit, "utf8").replace(/\s+/g, "");
  const tgz = path.join(work, "kit.tgz");
  writeFileSync(tgz, Buffer.from(hex, "hex"));
  const list = spawnSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  return list.stdout.split("\n").filter(Boolean).map((l) => l.replace(/\/$/, ""));
}

describe("ops/backup.sh restore kit", () => {
  it("encrypts .env and the server config with a passphrase passed on fd 3", () => {
    const r = runBackup({ BACKUP_PASSPHRASE: "correct horse battery staple" });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/restore kit OK \(passphrase/);

    const kits = backupFiles().filter((f) => /restore-kit-.*\.tar\.gz\.gpg$/.test(f));
    expect(kits).toHaveLength(1);
    expect(backupFiles().some((f) => f.endsWith(".partial"))).toBe(false);

    const argv = readFileSync(path.join(work, "gpg.argv"), "utf8");
    expect(argv).toMatch(/--symmetric/);
    expect(argv).toMatch(/--passphrase-fd\n3/);
    expect(argv).not.toMatch(/correct horse/);
    expect(readFileSync(path.join(work, "gpg.fd3"), "utf8").trim()).toBe(
      "correct horse battery staple",
    );

    const members = kitMembers(kits[0]!);
    for (const m of [".env", "docker-compose.yml", "nginx/nginx.conf", "nginx/conf.d/rtxshop.conf", "_deploy.sh"]) {
      expect(members, m).toContain(m);
    }
    noPlaintextSecrets();
  });

  it("prefers a gpg recipient (no decryption key on the server)", () => {
    const r = runBackup({ BACKUP_GPG_RECIPIENT: "owner@neurofax.uz", BACKUP_PASSPHRASE: "x" });
    expect(r.status, r.log).toBe(0);
    const argv = readFileSync(path.join(work, "gpg.argv"), "utf8");
    expect(argv).toMatch(/--recipient\nowner@neurofax\.uz\n--encrypt/);
    expect(argv).not.toMatch(/--symmetric/);
    noPlaintextSecrets();
  });

  it("skips loudly, and stores no key in plain text, when nothing is configured", () => {
    const r = runBackup({});
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/RESTORE KIT NOT SAVED: neither BACKUP_GPG_RECIPIENT nor BACKUP_PASSPHRASE is set/);
    expect(backupFiles().some((f) => f.includes("restore-kit"))).toBe(false);
    // The dump and the clinic files are still made.
    expect(backupFiles().some((f) => /pg-medbook-.*\.sql\.gz$/.test(f))).toBe(true);
    expect(backupFiles().some((f) => /files-.*\.tar\.gz$/.test(f))).toBe(true);
    noPlaintextSecrets();
  });
});

describe("ops/backup.sh encrypted copy to a Telegram channel", () => {
  function stubCurl(exitCode: number) {
    // Records every call and keeps a copy of each uploaded document, so the
    // test can check that only gpg output ever leaves the server.
    stub(
      "curl",
      [
        `printf '%s\\n' "$@" >> "${work}/curl.argv"`,
        `for a in "$@"; do case "$a" in document=@*) f="\${a#document=@}"; f="\${f%%;*}"; cat "$f" >> "${work}/uploaded.bin";; esac; done`,
        `exit ${exitCode}`,
        "",
      ].join("\n"),
    );
  }

  it("sends one encrypted archive with the dump, the files and the kit", () => {
    stubCurl(0);
    const r = runBackup({
      BACKUP_PASSPHRASE: "correct horse battery staple",
      BACKUP_TG_CHAT_ID: "-1001234567890",
      TELEGRAM_BOT_TOKEN: "123:bot-token",
    });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/telegram copy OK \(1 part\(s\)\)/);
    const argv = readFileSync(path.join(work, "curl.argv"), "utf8");
    expect(argv).toMatch(/sendDocument/);
    expect(argv).toMatch(/chat_id=-1001234567890/);
    expect(argv).toMatch(/caption=NeuroFax · бэкап/);
    // The upload is the gpg stub's hex output, never the plain dump or keys.
    const uploaded = readFileSync(path.join(work, "uploaded.bin"));
    expect(uploaded.includes(Buffer.from("marker-key-7f3a"))).toBe(false);
    expect(/^[0-9a-f\s]+$/.test(uploaded.toString("utf8"))).toBe(true);
    // The passphrase reached gpg on fd 3, not curl or a command line.
    expect(argv).not.toMatch(/correct horse/);
    noPlaintextSecrets();
  });

  it("never sends anything without encryption configured", () => {
    stubCurl(0);
    const r = runBackup({ BACKUP_TG_CHAT_ID: "-1001234567890", TELEGRAM_BOT_TOKEN: "123:bot-token" });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/TELEGRAM COPY SKIPPED: neither BACKUP_GPG_RECIPIENT nor BACKUP_PASSPHRASE is set/);
    expect(existsSync(path.join(work, "curl.argv"))).toBe(false);
  });

  it("a failed upload is loud but does not fail the local backup", () => {
    stubCurl(22);
    const r = runBackup({
      BACKUP_PASSPHRASE: "x",
      BACKUP_TG_CHAT_ID: "-1001234567890",
      TELEGRAM_BOT_TOKEN: "123:bot-token",
    });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/TELEGRAM COPY FAILED: 0\/1 part\(s\) sent/);
    expect(backupFiles().some((f) => /pg-medbook-.*\.sql\.gz$/.test(f))).toBe(true);
  });
});

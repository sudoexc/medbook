/**
 * Audit INF-15: ops/restore.sh piped the dump into psql without
 * ON_ERROR_STOP or a transaction. psql keeps going after an SQL error and
 * exits 0, so both the DRY_RUN check and a real restore printed success over
 * a half-loaded database, and the row counts were only printed.
 *
 * Pinned by running the real script against a stubbed `docker`:
 *   - the load runs `psql -v ON_ERROR_STOP=1 --single-transaction -f -`;
 *   - a failing load makes DRY_RUN (and a real restore) exit non-zero with
 *     no success line;
 *   - restored row counts are compared with the dump's COPY blocks;
 *   - a dump without pg_dump's end marker is refused before loading.
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
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../ops/restore.sh");

let work: string;
let appDir: string;
let stubDir: string;
let dumpPath: string;

const GOOD_DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "SET statement_timeout = 0;",
  'CREATE TABLE public."Patient" (id text NOT NULL);',
  'COPY public."Patient" (id) FROM stdin;',
  "p1",
  "p2",
  "\\.",
  'COPY public."Appointment" (id) FROM stdin;',
  "a1",
  "\\.",
  'COPY public."VisitNote" (id) FROM stdin;',
  "\\.",
  "--",
  "-- PostgreSQL database dump complete",
  "--",
  "",
].join("\n");

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "medbook-restore-"));
  appDir = path.join(work, "app");
  stubDir = path.join(work, "bin");
  mkdirSync(path.join(appDir, "ops"), { recursive: true });
  mkdirSync(stubDir);
  // The script cds to its own parent; a copy keeps it away from this
  // checkout's real .env.
  copyFileSync(SCRIPT, path.join(appDir, "ops", "restore.sh"));
  dumpPath = path.join(work, "pg-medbook-test.sql.gz");
  writeFileSync(dumpPath, gzipSync(GOOD_DUMP));

  // docker: the load (`-f -`) records argv + stdin and fails on demand; the
  // count queries answer from STUB_<TABLE>, defaulting to the dump's counts.
  const p = path.join(stubDir, "docker");
  writeFileSync(
    p,
    [
      "#!/bin/sh",
      'case "$*" in',
      `  *"-f -"*) printf '%s\\n' "$@" > "${work}/load.argv"; cat > "${work}/loaded.sql";`,
      '    [ -n "$STUB_LOAD_ERR" ] && echo "$STUB_LOAD_ERR" >&2',
      '    exit "${STUB_LOAD_EXIT:-0}" ;;',
      "  *pg_dump*) echo 'safety' ;;",
      `  *'count(*) from "Patient"'*) echo "\${STUB_PATIENT:-2}" ;;`,
      `  *'count(*) from "Appointment"'*) echo "\${STUB_APPOINTMENT:-1}" ;;`,
      `  *'count(*) from'*) echo 0 ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(p, 0o755);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function runRestore(env: Record<string, string>, input = "") {
  const res = spawnSync("bash", [path.join(appDir, "ops", "restore.sh"), dumpPath], {
    encoding: "utf8",
    input,
    env: {
      NODE_ENV: "test",
      PATH: `${stubDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: work,
      TMPDIR: work,
      ...env,
    },
  });
  return { ...res, log: `${res.stdout}\n${res.stderr}` };
}

describe("ops/restore.sh verifies what it loaded", () => {
  it("DRY_RUN loads with ON_ERROR_STOP in one transaction and passes on a good dump", () => {
    const r = runRestore({ DRY_RUN: "1" });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/dry run OK/);
    const argv = readFileSync(path.join(work, "load.argv"), "utf8").split("\n");
    expect(argv).toContain("ON_ERROR_STOP=1");
    expect(argv).toContain("--single-transaction");
    expect(argv.join(" ")).toMatch(/-f -/);
    expect(readFileSync(path.join(work, "loaded.sql"), "utf8")).toBe(GOOD_DUMP);
  });

  it("DRY_RUN fails when psql stops on an SQL error", () => {
    const r = runRestore({
      DRY_RUN: "1",
      STUB_LOAD_EXIT: "3",
      STUB_LOAD_ERR: 'psql:<stdin>:6: ERROR:  relation "public.Patient" does not exist',
    });
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/NOT restorable/);
    expect(r.log).toMatch(/relation "public\.Patient" does not exist/);
    expect(r.log).not.toMatch(/dry run OK/);
  });

  it("DRY_RUN fails when restored row counts differ from the dump", () => {
    const r = runRestore({ DRY_RUN: "1", STUB_PATIENT: "1" });
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/Patient\s+2 →\s+1\s+MISMATCH/);
    expect(r.log).not.toMatch(/dry run OK/);
  });

  it("refuses a dump without pg_dump's end marker before loading anything", () => {
    writeFileSync(
      dumpPath,
      gzipSync(GOOD_DUMP.replace("-- PostgreSQL database dump complete", "")),
    );
    const r = runRestore({ DRY_RUN: "1" });
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/no pg_dump end marker/);
    expect(existsSync(path.join(work, "load.argv"))).toBe(false);
  });

  it("a real restore whose load fails exits non-zero and never says done", () => {
    const r = runRestore(
      { STUB_LOAD_EXIT: "3", STUB_LOAD_ERR: "ERROR:  boom" },
      "YES\n",
    );
    expect(r.status).not.toBe(0);
    expect(r.log).toMatch(/rolled back/);
    expect(r.log).toMatch(/rollback dump/);
    expect(r.log).not.toMatch(/\[restore\] done/);
  });

  it("a real restore with matching counts completes", () => {
    const r = runRestore({}, "YES\n");
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/\[restore\] done/);
  });
});

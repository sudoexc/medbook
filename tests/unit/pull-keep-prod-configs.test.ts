/**
 * Review of 23390e8 (INF-07): /opt/neurofax marks docker-compose.yml,
 * nginx/nginx.conf and the neighbours' vhosts skip-worktree, with prod-only
 * edits in them. A commit that changes one of them made the deploy's
 * `git pull --ff-only` abort ("would be overwritten by merge"), so no fix at
 * all could reach the clinic until someone untangled it by hand.
 *
 * Pinned by running the real ops/pull-keep-prod-configs.sh against scratch
 * repositories shaped like the server:
 *   - an upstream change to a protected config no longer blocks the pull; the
 *     production copies stay byte for byte, stay flagged, are backed up, and
 *     the upstream diff is printed for porting (exit 3 stops `&& _deploy.sh`);
 *   - a pull that does not touch them is a plain fast-forward (exit 0) and
 *     never rewrites the files (the nginx bind mount keeps its inode);
 *   - diverged history and a failed merge change nothing, configs included.
 */
import { spawnSync } from "node:child_process";
import {
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

const SCRIPT = path.resolve(__dirname, "../../ops/pull-keep-prod-configs.sh");

const PROTECTED = [
  "docker-compose.yml",
  "nginx/nginx.conf",
  "nginx/conf.d/rtxshop.conf",
  "nginx/conf.d/orientatravel.conf",
];

let work: string;
let up: string;
let prod: string;
let bakRoot: string;
let env: NodeJS.ProcessEnv;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout.trim();
}

function write(dir: string, file: string, content: string) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
}

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), "utf8");
}

function commitUpstream(files: Record<string, string>, message: string) {
  for (const [f, c] of Object.entries(files)) write(up, f, c);
  git(up, "add", "-A");
  git(up, "commit", "-q", "-m", message);
}

function runScript() {
  return spawnSync("bash", [SCRIPT], { cwd: prod, env, encoding: "utf8" });
}

function skipFlagged(): string[] {
  return git(prod, "ls-files", "-v")
    .split("\n")
    .filter((l) => l.startsWith("S "))
    .map((l) => l.slice(2))
    .sort();
}

const PROD_EDIT: Record<string, string> = {
  "docker-compose.yml": "services:\n  app: {}\n  # prod-only: MINIO keys from /opt/neurofax/.env\n",
  "nginx/nginx.conf":
    "http {\n  include /etc/nginx/conf.d/*.conf;\n  upstream medbook_minio { server minio:9000; }\n  location /files/ { proxy_pass http://medbook_minio/; }\n  # prod-only tuning\n}\n",
  "nginx/conf.d/rtxshop.conf": "server { server_name rtxshop.uz; } # live vhost\n",
  "nginx/conf.d/orientatravel.conf": "server { server_name orientatravel.uz; } # live vhost\n",
};

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "medbook-pull-"));
  up = path.join(work, "up");
  prod = path.join(work, "prod");
  bakRoot = path.join(work, "bak");
  // Isolated from the developer's git config (signing, hooks, default branch).
  env = {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    HOME: work,
    XDG_CONFIG_HOME: work,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(work, "gitconfig"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.test",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.test",
    BACKUP_ROOT: bakRoot,
  };
  writeFileSync(path.join(work, "gitconfig"), "");

  mkdirSync(up);
  git(up, "init", "-q", "-b", "main");
  commitUpstream(
    {
      "docker-compose.yml": "services:\n  app: {}\n",
      "nginx/nginx.conf":
        "http {\n  include /etc/nginx/conf.d/*.conf;\n  upstream medbook_minio { server minio:9000; }\n  location /files/ { proxy_pass http://medbook_minio/; }\n}\n",
      "nginx/conf.d/rtxshop.conf": "server { server_name rtxshop.uz; }\n",
      "nginx/conf.d/orientatravel.conf": "server { server_name orientatravel.uz; }\n",
      "src/app.txt": "v1\n",
    },
    "init",
  );

  git(work, "clone", "-q", up, prod);
  for (const f of PROTECTED) write(prod, f, PROD_EDIT[f]!);
  git(prod, "update-index", "--skip-worktree", "--", ...PROTECTED);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("ops/pull-keep-prod-configs.sh", () => {
  it("pulls a commit that changes nginx.conf and compose, keeping the production copies", () => {
    commitUpstream(
      {
        "docker-compose.yml": "services:\n  app: {}\n  minio:\n    environment:\n      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY:?set it}\n",
        "nginx/nginx.conf": "http {\n  include /etc/nginx/conf.d/*.conf;\n}\n",
        "src/app.txt": "v2\n",
      },
      "INF-07",
    );
    // The bug: the standard step 1 of the deploy refuses.
    const plain = spawnSync("git", ["pull", "--ff-only"], { cwd: prod, env, encoding: "utf8" });
    expect(plain.status).not.toBe(0);
    expect(plain.stderr).toMatch(/would be overwritten by merge/);

    const r = runScript();

    expect(r.status).toBe(3);
    expect(git(prod, "rev-parse", "HEAD")).toBe(git(up, "rev-parse", "HEAD"));
    expect(read(prod, "src/app.txt")).toBe("v2\n");
    for (const f of PROTECTED) expect(read(prod, f)).toBe(PROD_EDIT[f]);
    expect(skipFlagged()).toEqual([...PROTECTED].sort());

    // Backed up before anything was touched, with the upstream diff next to it.
    const [stamp] = readdirSync(bakRoot);
    const bak = path.join(bakRoot, stamp!);
    for (const f of PROTECTED) expect(read(bak, f)).toBe(PROD_EDIT[f]);
    expect(read(bak, "upstream.diff")).toMatch(/^-\s+location \/files\//m);

    expect(r.stdout).toMatch(/ACTION NEEDED/);
    expect(r.stdout).toMatch(/\[pull\] {3}docker-compose\.yml/);
    expect(r.stdout).toMatch(/\[pull\] {3}nginx\/nginx\.conf/);
    expect(r.stdout).not.toMatch(/\[pull\] {3}nginx\/conf\.d/);
    expect(r.stdout).toMatch(/^-\s+upstream medbook_minio/m);
    expect(r.stdout).toMatch(/RECREATE nginx/);
  });

  it("a pull that does not touch the configs is a plain fast-forward and leaves the files alone", () => {
    const inode = statSync(path.join(prod, "nginx/nginx.conf")).ino;
    commitUpstream({ "src/app.txt": "v2\n" }, "app only");

    const r = runScript();

    expect(r.status).toBe(0);
    expect(git(prod, "rev-parse", "HEAD")).toBe(git(up, "rev-parse", "HEAD"));
    expect(read(prod, "src/app.txt")).toBe("v2\n");
    for (const f of PROTECTED) expect(read(prod, f)).toBe(PROD_EDIT[f]);
    // The nginx container bind-mounts this exact inode.
    expect(statSync(path.join(prod, "nginx/nginx.conf")).ino).toBe(inode);
    expect(skipFlagged()).toEqual([...PROTECTED].sort());
    expect(existsSync(bakRoot)).toBe(false);
  });

  it("is a no-op when already up to date", () => {
    const r = runScript();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already up to date/);
    expect(existsSync(bakRoot)).toBe(false);
  });

  it("refuses diverged history and changes nothing", () => {
    const head = git(prod, "rev-parse", "HEAD");
    write(prod, "src/app.txt", "local\n");
    git(prod, "commit", "-q", "-am", "local hotfix");
    const local = git(prod, "rev-parse", "HEAD");
    commitUpstream({ "nginx/nginx.conf": "http {}\n", "src/app.txt": "v2\n" }, "upstream");

    const r = runScript();

    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/REFUSED/);
    expect(git(prod, "rev-parse", "HEAD")).toBe(local);
    expect(local).not.toBe(head);
    for (const f of PROTECTED) expect(read(prod, f)).toBe(PROD_EDIT[f]);
    expect(skipFlagged()).toEqual([...PROTECTED].sort());
  });

  it("puts the production configs back when the merge itself fails", () => {
    const head = git(prod, "rev-parse", "HEAD");
    commitUpstream(
      { "nginx/nginx.conf": "http {}\n", "src/new.txt": "from upstream\n" },
      "adds a file",
    );
    // An untracked file in the way makes the fast-forward refuse.
    write(prod, "src/new.txt", "left on the server\n");

    const r = runScript();

    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(3);
    expect(r.stdout).toMatch(/FAILED: putting the production configs back/);
    expect(git(prod, "rev-parse", "HEAD")).toBe(head);
    for (const f of PROTECTED) expect(read(prod, f)).toBe(PROD_EDIT[f]);
    expect(skipFlagged()).toEqual([...PROTECTED].sort());
    // The operator's plain pull is in the same state as before the run.
    expect(git(prod, "status", "--porcelain")).toBe("?? src/new.txt");
  });
});

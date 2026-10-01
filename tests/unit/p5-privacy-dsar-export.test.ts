/**
 * Audit PT-09: the patient's data export could not be used by any path:
 * no button in the card, a password nobody ever saw (generated in the
 * worker, stored as a bcrypt hash), and a decrypt.sh calling `openssl enc
 * -aes-256-gcm -tag`, which openssl does not support, so no archive could be
 * opened. The default «exports» bucket was never created.
 *
 * Pinned: the archive encrypted by `packDsarBundle` is decrypted by its own
 * decrypt.sh with the openssl of this machine (skipped where there is none);
 * a wrong passphrase is refused; the admin's request returns the password
 * once and the worker gets it sealed; the bundles live in the app's bucket.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packDsarBundle } from "@/server/dsar/zip";

/** STORED-only zip reader for our own writer's output. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const start = off + 30 + nameLen + extra;
    out[name] = buf.subarray(start, start + size);
    off = start + size;
  }
  return out;
}

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("decrypt.sh opens the archive with stock openssl", () => {
  const json = JSON.stringify({ patient: { fullName: "Каримова Дилноза" }, n: 42 });
  const passphrase = "abcd2345-efgh6789-jkmn2345";
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "dsar-"));
    const files = unzip(packDsarBundle(json, passphrase, "NeuroFax", "NeuroFax"));
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "data.json.enc",
      "data.json.enc.hmac",
      "decrypt.sh",
    ]);
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    // The ciphertext is the standard `openssl enc` format, not GCM.
    expect(files["data.json.enc"]!.subarray(0, 8).toString("ascii")).toBe("Salted__");
    expect(files["decrypt.sh"]!.toString()).not.toContain("gcm");
    expect(files["README.txt"]!.toString()).not.toMatch(/[—–]/);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!hasOpenssl())("the right passphrase restores data.json", () => {
    const run = spawnSync("bash", [path.join(dir, "decrypt.sh")], {
      env: { ...process.env, PASSPHRASE: passphrase },
      encoding: "utf8",
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(readFileSync(path.join(dir, "data.json"), "utf8")).toBe(json);
  });

  it.skipIf(!hasOpenssl())("a wrong passphrase is refused and writes nothing", () => {
    const run = spawnSync("bash", [path.join(dir, "decrypt.sh")], {
      env: { ...process.env, PASSPHRASE: "wrong-pass" },
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("Wrong passphrase");
    expect(existsSync(path.join(dir, "data.json"))).toBe(false);
  });

  it.skipIf(!hasOpenssl())("plain openssl reads it too, as the README says", () => {
    const out = execFileSync(
      "openssl",
      ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256",
        "-in", path.join(dir, "data.json.enc"), "-pass", "env:PASSPHRASE"],
      { env: { ...process.env, PASSPHRASE: passphrase } },
    );
    expect(out.toString("utf8")).toBe(json);
  });
});

describe("the admin's password reaches the worker sealed", () => {
  it("enqueueExportJob puts ciphertext in the queue, never the password", async () => {
    vi.resetModules();
    const enqueue = vi.fn(async () => undefined);
    vi.doMock("@/server/queue", () => ({ enqueue, getQueue: vi.fn() }));
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    // Fresh module graph: the key goes on the cipher instance it uses.
    const cipher = await import("@/server/crypto/field-cipher");
    cipher.__setKeyForTests({ active: "v1", keys: { v1: randomBytes(32) } });
    const { enqueueExportJob } = await import("@/server/workers/data-export");
    await enqueueExportJob("job_1", { passphrase: "abcd2345-efgh6789-jkmn2345" });
    const payload = (enqueue.mock.calls[0] as unknown[])[2] as {
      jobId: string;
      sealedPassphrase: string;
    };
    expect(payload.jobId).toBe("job_1");
    expect(JSON.stringify(payload)).not.toContain("abcd2345");
    expect(cipher.decryptField(payload.sealedPassphrase)).toBe("abcd2345-efgh6789-jkmn2345");
    // A Mini App request carries none: the worker makes one for the chat.
    await enqueueExportJob("job_2");
    expect((enqueue.mock.calls[1] as unknown[])[2]).toEqual({ jobId: "job_2" });
    vi.doUnmock("@/server/queue");
    vi.doUnmock("@/lib/prisma");
    cipher.__resetKeyCacheForTests();
  });
});

describe("the card's export request", () => {
  it("returns the password from the API once, and says where the archive goes", async () => {
    const { requestPatientDataExport } = await import(
      "@/app/[locale]/crm/patients/[id]/_components/patient-privacy-dialogs"
    );
    const ok = vi.fn(async () =>
      Response.json({ jobId: "j", passphrase: "p-a-s", deliversToTelegram: false }),
    );
    expect(await requestPatientDataExport("p1", ok as never)).toEqual({
      kind: "ok",
      result: { passphrase: "p-a-s", deliversToTelegram: false },
    });
    const busy = vi.fn(async () => Response.json({ error: "already_active" }, { status: 409 }));
    expect(await requestPatientDataExport("p1", busy as never)).toEqual({ kind: "already_active" });
  });

  it("the route makes the password, returns it and seals it for the worker", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/patients/[id]/data-export/route.ts"),
      "utf8",
    );
    expect(src).toContain("const passphrase = generatePassphrase();");
    expect(src).toContain("enqueueExportJob(job.id, { passphrase })");
    expect(src).toMatch(/return ok\(\{[\s\S]*passphrase,/);
  });

  it("the patient card offers it to the admin", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx"),
      "utf8",
    );
    expect(src).toContain("<PatientDataExportDialog");
    expect(src).toContain("<PatientErasureRequestDialog");
  });
});

describe("where bundles are stored", () => {
  it("the app's own bucket by default (undefined = MINIO_BUCKET)", async () => {
    const prev = process.env.MINIO_EXPORTS_BUCKET;
    delete process.env.MINIO_EXPORTS_BUCKET;
    vi.resetModules();
    const { DSAR_EXPORTS_BUCKET } = await import("@/server/dsar/expiry");
    expect(DSAR_EXPORTS_BUCKET).toBeUndefined();
    if (prev !== undefined) process.env.MINIO_EXPORTS_BUCKET = prev;
  });
});

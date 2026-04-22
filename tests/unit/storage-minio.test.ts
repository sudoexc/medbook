/**
 * MinIO adapter — stub mode tests.
 *
 * These tests only exercise the local /tmp fallback (MINIO_ENDPOINT unset).
 * S3 mode requires the AWS SDK and a live MinIO — covered in integration
 * tests, not here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  __resetStorageForTests,
  deleteObject,
  getSignedUrl,
  isStubMode,
  uploadObject,
} from "@/server/storage/minio";

const ORIGINAL_ENDPOINT = process.env.MINIO_ENDPOINT;

describe("storage/minio — stub mode", () => {
  beforeEach(() => {
    delete process.env.MINIO_ENDPOINT;
    __resetStorageForTests();
  });

  afterEach(() => {
    if (typeof ORIGINAL_ENDPOINT === "string") {
      process.env.MINIO_ENDPOINT = ORIGINAL_ENDPOINT;
    } else {
      delete process.env.MINIO_ENDPOINT;
    }
    __resetStorageForTests();
  });

  it("reports stub mode when MINIO_ENDPOINT is unset", () => {
    expect(isStubMode()).toBe(true);
  });

  it("uploadObject writes under /tmp/medbook-uploads and returns a file:// url", async () => {
    const bucket = "test-bucket";
    const key = `unit/${Date.now()}-hello.txt`;
    const body = Buffer.from("hello world", "utf8");

    const result = await uploadObject(bucket, key, body, "text/plain");

    expect(result.key).toBe(key);
    expect(result.url.startsWith("file://")).toBe(true);

    const expectedPath = path.join(tmpdir(), "medbook-uploads", bucket, key);
    const contents = await fs.readFile(expectedPath, "utf8");
    expect(contents).toBe("hello world");

    // cleanup
    await deleteObject(bucket, key);
  });

  it("getSignedUrl returns file:// in stub mode (no presigning)", async () => {
    const url = await getSignedUrl("test-bucket", "abc/def.jpg", 60);
    expect(url.startsWith("file://")).toBe(true);
    expect(url).toContain("test-bucket");
    expect(url).toContain("abc/def.jpg");
  });

  it("deleteObject removes a previously-uploaded stub file", async () => {
    const bucket = "stub-del";
    const key = `del/${Date.now()}-x.bin`;
    const body = Buffer.from([1, 2, 3]);

    await uploadObject(bucket, key, body, "application/octet-stream");
    const filePath = path.join(tmpdir(), "medbook-uploads", bucket, key);
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    await deleteObject(bucket, key);
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("deleteObject is idempotent on missing keys", async () => {
    await expect(deleteObject("nope", "does/not/exist")).resolves.toBeUndefined();
  });

  it("refuses to escape the upload root via ../ keys", async () => {
    const bucket = "safety";
    // `../` segments are stripped; the final path must stay inside the bucket
    // directory — it can never resolve above `/tmp/medbook-uploads/<bucket>/`.
    const key = "../../etc/hosts";
    const written = await uploadObject(bucket, key, Buffer.from("x"), "text/plain");
    const root = path.join(tmpdir(), "medbook-uploads", bucket);
    expect(written.url).toContain(root);
    // The written file must resolve below `root` (no escape).
    const asPath = written.url.replace(/^file:\/\//, "");
    const rel = path.relative(root, asPath);
    expect(rel.startsWith("..")).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
    await deleteObject(bucket, key);
  });

  it("resolves bucket from MINIO_BUCKET env when not passed", async () => {
    process.env.MINIO_BUCKET = "env-bucket";
    const key = `default-bucket/${Date.now()}.txt`;
    const result = await uploadObject(undefined, key, Buffer.from("x"), "text/plain");
    expect(result.url).toContain(path.join("medbook-uploads", "env-bucket"));
    await deleteObject(undefined, key);
  });
});

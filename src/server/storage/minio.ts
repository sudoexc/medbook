/**
 * MinIO / S3-compatible storage adapter.
 *
 * Two modes, chosen by the presence of `MINIO_ENDPOINT`:
 *
 *   1. **S3 mode** (MINIO_ENDPOINT set) — uses `@aws-sdk/client-s3` +
 *      `@aws-sdk/s3-request-presigner`.
 *   2. **Stub mode** (MINIO_ENDPOINT empty) — writes objects under
 *      `${os.tmpdir()}/medbook-uploads/<bucket>/<key>` and returns
 *      `file://` URLs. Used for local `npm run dev` and unit tests.
 *
 * The S3 client is constructed lazily on first use so stub-mode runs never
 * pay the construction cost, but the SDK modules themselves are statically
 * imported so Next.js standalone tracing can follow the full dep graph.
 *
 * Public surface:
 *   - uploadObject(bucket, key, buffer, contentType) → { url, key }
 *   - getSignedUrl(bucket, key, expiresInSeconds)     → string
 *   - deleteObject(bucket, key)                        → void
 *   - isStubMode()                                     → boolean
 *
 * The adapter is tenant-agnostic — callers are responsible for scoping keys
 * by `clinicId`. Convention: `clinics/<clinicId>/documents/<uuid>.<ext>`.
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignSignedUrl } from "@aws-sdk/s3-request-presigner";

export type UploadResult = {
  /** Public-ish URL (presigned or file://). Callers can persist it. */
  url: string;
  /** Canonical storage key. */
  key: string;
};

function resolveBucket(bucket: string | undefined): string {
  return bucket && bucket.length > 0
    ? bucket
    : process.env.MINIO_BUCKET || "medbook";
}

export function isStubMode(): boolean {
  return !process.env.MINIO_ENDPOINT;
}

// ---------------------------------------------------------------------------
// Stub implementation (dev / tests)
// ---------------------------------------------------------------------------

function stubRoot(): string {
  return path.join(tmpdir(), "medbook-uploads");
}

function stubPath(bucket: string, key: string): string {
  // sanitise so ".." can't escape the root.
  const safeKey = key.replace(/\.\.(?:\/|\\)/g, "");
  return path.join(stubRoot(), bucket, safeKey);
}

async function stubUpload(
  bucket: string,
  key: string,
  body: Buffer,
  _contentType: string,
): Promise<UploadResult> {
  void _contentType;
  const filePath = stubPath(bucket, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  return { key, url: `file://${filePath}` };
}

function stubSignedUrl(bucket: string, key: string): string {
  return `file://${stubPath(bucket, key)}`;
}

async function stubDelete(bucket: string, key: string): Promise<void> {
  const filePath = stubPath(bucket, key);
  try {
    await fs.unlink(filePath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") throw err;
  }
}

// ---------------------------------------------------------------------------
// S3 / MinIO implementation (client lazily constructed)
// ---------------------------------------------------------------------------

let cachedClient: S3Client | null = null;
// Separate client for browser-facing presigned URLs. Uses MINIO_PUBLIC_URL as
// the endpoint so the resulting URL contains the host the browser can reach
// (e.g. https://neurofax.uz/files), not the docker-internal host (minio:9000).
let cachedPublicClient: S3Client | null = null;

function buildClient(endpoint: string): S3Client {
  const region = process.env.MINIO_REGION || "us-east-1";
  const forcePathStyle =
    (process.env.MINIO_FORCE_PATH_STYLE ?? "true") !== "false";
  return new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY || "",
      secretAccessKey: process.env.MINIO_SECRET_KEY || "",
    },
  });
}

function getClient(): S3Client {
  if (!cachedClient) cachedClient = buildClient(process.env.MINIO_ENDPOINT!);
  return cachedClient;
}

function getPublicClient(): S3Client {
  if (!cachedPublicClient) {
    cachedPublicClient = buildClient(
      process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT!,
    );
  }
  return cachedPublicClient;
}

/** Testing only — drop cached SDK client so env changes take effect. */
export function __resetStorageForTests(): void {
  cachedClient = null;
  cachedPublicClient = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function uploadObject(
  bucket: string | undefined,
  key: string,
  body: Buffer,
  contentType = "application/octet-stream",
): Promise<UploadResult> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    return stubUpload(b, key, body, contentType);
  }
  await getClient().send(
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  const pub = process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT!;
  return { key, url: `${pub.replace(/\/$/, "")}/${b}/${key}` };
}

export async function getSignedUrl(
  bucket: string | undefined,
  key: string,
  expiresIn = 900,
): Promise<string> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    return stubSignedUrl(b, key);
  }
  const cmd = new GetObjectCommand({ Bucket: b, Key: key });
  return presignSignedUrl(getPublicClient(), cmd, { expiresIn });
}

/**
 * Presign a PUT URL the browser can use to upload bytes directly to MinIO.
 * Distinct from {@link getSignedUrl} (which is for downloads/reads).
 */
export async function getSignedUploadUrl(
  bucket: string | undefined,
  key: string,
  contentType = "application/octet-stream",
  expiresIn = 900,
): Promise<string> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    return stubSignedUrl(b, key);
  }
  const cmd = new PutObjectCommand({
    Bucket: b,
    Key: key,
    ContentType: contentType,
  });
  return presignSignedUrl(getPublicClient(), cmd, { expiresIn });
}

export async function deleteObject(
  bucket: string | undefined,
  key: string,
): Promise<void> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    return stubDelete(b, key);
  }
  await getClient().send(new DeleteObjectCommand({ Bucket: b, Key: key }));
}

/**
 * Read an object as a streamable response. Uses the internal client so the
 * fetch goes over the docker network (no presigning round-trip / nginx-rewrite
 * signature mismatch). Caller is responsible for streaming the body back to
 * the browser with the correct Content-Type / Content-Disposition.
 */
export type ObjectFetchResult = {
  body: ReadableStream<Uint8Array> | null;
  contentType: string | null;
  contentLength: number | null;
};

export async function fetchObject(
  bucket: string | undefined,
  key: string,
): Promise<ObjectFetchResult> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    const filePath = stubPath(b, key);
    const bytes = await fs.readFile(filePath);
    return {
      body: new Response(new Uint8Array(bytes)).body,
      contentType: "application/octet-stream",
      contentLength: bytes.byteLength,
    };
  }
  const out = await getClient().send(
    new GetObjectCommand({ Bucket: b, Key: key }),
  );
  return {
    body: (out.Body as ReadableStream<Uint8Array> | undefined) ?? null,
    contentType: out.ContentType ?? null,
    contentLength: out.ContentLength ?? null,
  };
}


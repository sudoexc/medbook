/**
 * MinIO / S3-compatible storage adapter.
 *
 * Two modes, chosen by the presence of `MINIO_ENDPOINT`:
 *
 *   1. **S3 mode** (MINIO_ENDPOINT set)
 *      Uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
 *      Imported lazily so the dev mode works without installing the AWS SDK.
 *      When the SDK is missing we throw a helpful error pointing at
 *      `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.
 *
 *   2. **Stub mode** (MINIO_ENDPOINT empty)
 *      Writes objects under `${os.tmpdir()}/medbook-uploads/<bucket>/<key>`
 *      and returns `file://` URLs. Used for local `npm run dev` and for
 *      unit tests. Deletions / signed URLs are no-ops that return the local
 *      path.
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
// S3 / MinIO implementation (lazy-loaded)
// ---------------------------------------------------------------------------

type S3ClientLike = {
  send: (cmd: unknown) => Promise<unknown>;
};

type S3Module = {
  S3Client: new (cfg: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
};

type PresignerModule = {
  getSignedUrl: (
    client: S3ClientLike,
    cmd: unknown,
    opts: { expiresIn: number },
  ) => Promise<string>;
};

let clientPromise: Promise<{
  client: S3ClientLike;
  s3: S3Module;
  presigner: PresignerModule;
}> | null = null;

// Use `Function`-wrapped dynamic imports so TypeScript doesn't try to
// resolve the module at compile-time — these SDKs are optional runtime
// dependencies (only required when MINIO_ENDPOINT is set).
const dynamicImport = new Function("spec", "return import(spec)") as (
  spec: string,
) => Promise<unknown>;

async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let s3: S3Module;
    let presigner: PresignerModule;
    try {
      s3 = (await dynamicImport("@aws-sdk/client-s3")) as S3Module;
      presigner = (await dynamicImport(
        "@aws-sdk/s3-request-presigner",
      )) as PresignerModule;
    } catch (e) {
      throw new Error(
        "MinIO adapter: @aws-sdk/client-s3 / @aws-sdk/s3-request-presigner " +
          "not installed. Run `npm install @aws-sdk/client-s3 " +
          "@aws-sdk/s3-request-presigner` or unset MINIO_ENDPOINT to use " +
          "the stub. Underlying error: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
    const endpoint = process.env.MINIO_ENDPOINT!;
    const region = process.env.MINIO_REGION || "us-east-1";
    const forcePathStyle =
      (process.env.MINIO_FORCE_PATH_STYLE ?? "true") !== "false";
    const client = new s3.S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || "",
        secretAccessKey: process.env.MINIO_SECRET_KEY || "",
      },
    });
    return { client, s3, presigner };
  })();
  return clientPromise;
}

/** Testing only — drop cached SDK client so env changes take effect. */
export function __resetStorageForTests(): void {
  clientPromise = null;
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
  const { client, s3 } = await getClient();
  await client.send(
    new s3.PutObjectCommand({
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
  const { client, s3, presigner } = await getClient();
  const cmd = new s3.GetObjectCommand({ Bucket: b, Key: key });
  return presigner.getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteObject(
  bucket: string | undefined,
  key: string,
): Promise<void> {
  const b = resolveBucket(bucket);
  if (isStubMode()) {
    return stubDelete(b, key);
  }
  const { client, s3 } = await getClient();
  await client.send(new s3.DeleteObjectCommand({ Bucket: b, Key: key }));
}

// ---------------------------------------------------------------------------
// Health probe — used by /api/health.
// ---------------------------------------------------------------------------

export async function pingStorage(): Promise<"ok" | "down" | "stub"> {
  if (isStubMode()) return "stub";
  try {
    await getClient();
    // Cheap probe: attempt to list via HeadBucket-like call. Use PutObject with
    // a zero-byte sentinel under `_healthcheck/` so we don't require ListBucket.
    await uploadObject(undefined, "_healthcheck/ping", Buffer.from(""), "text/plain");
    return "ok";
  } catch {
    return "down";
  }
}

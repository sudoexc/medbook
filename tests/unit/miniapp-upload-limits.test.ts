/**
 * Audit CD-04: Mini App document uploads had no rate limit and no quota. A
 * script holding one patient's initData could push 10 MB files in a loop,
 * tens of GB an hour, into MinIO on the shared VPS (Postgres and the
 * neighbours' sites on the same disk), and plant thousands of «Фото от
 * пациента» rows in the chart.
 *
 * Acceptance: the 21st upload in an hour is 429; going over the day's
 * volume is 429 with a clear message in the Mini App. Also pinned: the
 * account's total, a declared oversize body refused before it is read,
 * nginx's coarse guard, and the disk alert in the watchdog.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aggregates: [] as Array<Record<string, unknown>>,
  dayBytes: 0,
  totalBytes: 0,
  formDataCalls: 0,
  uploads: 0,
  audits: [] as Array<{ actor: unknown; input: Record<string, unknown> }>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/miniapp/handler", () => ({
  resolveMiniAppContext: vi.fn(async () => ({
    ok: true,
    ctx: {
      clinicId: "c1",
      clinicSlug: "neurofax",
      patientId: "p_owner",
      patient: { preferredLang: "RU" },
    },
  })),
  createMiniAppListHandler: () => async () => new Response(null),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p_owner",
    isOnBehalfOf: false,
    ownerPatientId: "p_owner",
  })),
  getFamilyAllowedPatientIds: vi.fn(async () => ["p_owner", "p_mother"]),
}));
vi.mock("@/server/storage/safe-file", () => ({
  DOCUMENT_TYPES: ["image/png"],
  checkUpload: () => ({ ok: true, mime: "image/png" }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async () => {
    h.uploads += 1;
    return { url: "http://minio/b/k.png" };
  }),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/miniapp/link-token", () => ({ miniAppDocumentUrl: () => "/x" }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(),
  auditMiniApp: vi.fn(async (_r: Request, actor: unknown, input: Record<string, unknown>) => {
    h.audits.push({ actor, input });
  }),
}));
vi.mock("@/lib/prisma", () => {
  const document = {
    aggregate: vi.fn(async (args: Record<string, unknown>) => {
      h.aggregates.push(args);
      const where = args.where as { createdAt?: unknown };
      return { _sum: { sizeBytes: where.createdAt ? h.dayBytes : h.totalBytes } };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "doc_1",
      type: data.type,
      title: data.title,
      fileUrl: data.fileUrl,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      createdAt: new Date(),
    })),
  };
  return {
    prisma: {
      document,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ document })),
    },
  };
});

import { POST } from "@/app/api/miniapp/documents/route";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import {
  MINIAPP_UPLOAD_BYTES_PER_DAY,
  MINIAPP_UPLOAD_BYTES_TOTAL,
  MINIAPP_UPLOADS_PER_HOUR,
  patientUploadWhere,
  uploadQuotaRefusal,
} from "@/server/miniapp/upload-quota";
import { uploadErrorText } from "@/app/c/[slug]/my/_lib/upload-errors";
import { ruDict } from "@/app/c/[slug]/my/_messages/ru";
import { uzDict } from "@/app/c/[slug]/my/_messages/uz";

const MB = 1024 * 1024;

function upload(sizeBytes = 1 * MB, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(sizeBytes)], "mri.png", { type: "image/png" }));
  const req = new Request("https://neurofax.uz/api/miniapp/documents?clinicSlug=neurofax", {
    method: "POST",
    body: form,
    headers,
  });
  const original = req.formData.bind(req);
  req.formData = async () => {
    h.formDataCalls += 1;
    return original();
  };
  return req;
}

beforeEach(() => {
  __resetRateLimitsForTests();
  h.aggregates = [];
  h.dayBytes = 0;
  h.totalBytes = 0;
  h.formDataCalls = 0;
  h.uploads = 0;
  h.audits = [];
});

describe("the limits", () => {
  it("day and total volume, per account", () => {
    expect(uploadQuotaRefusal({ lastDayBytes: 0, totalBytes: 0 }, 10 * MB)).toBeNull();
    expect(
      uploadQuotaRefusal({ lastDayBytes: MINIAPP_UPLOAD_BYTES_PER_DAY - 5 * MB, totalBytes: 0 }, 6 * MB),
    ).toMatchObject({ reason: "upload_daily_quota", retryAfterSec: 3600 });
    expect(
      uploadQuotaRefusal({ lastDayBytes: 0, totalBytes: MINIAPP_UPLOAD_BYTES_TOTAL }, 1),
    ).toMatchObject({ reason: "upload_total_quota" });
  });

  it("counts the patient's own uploads only: no staff upload, no rendered conclusion or referral", () => {
    expect(patientUploadWhere("c1", ["p1", "p2"])).toEqual({
      clinicId: "c1",
      patientId: { in: ["p1", "p2"] },
      uploadedById: null,
      visitNoteId: null,
      referralId: null,
    });
  });
});

describe("POST /api/miniapp/documents", () => {
  it("the 21st upload in an hour is 429, before the body is read", async () => {
    for (let i = 0; i < MINIAPP_UPLOADS_PER_HOUR; i += 1) {
      expect((await POST(upload())).status).toBe(201);
    }
    const res = await POST(upload());
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("upload_rate_limited");
    expect(h.formDataCalls).toBe(MINIAPP_UPLOADS_PER_HOUR);
    expect(h.uploads).toBe(MINIAPP_UPLOADS_PER_HOUR);
  });

  it("the account's whole family shares the volume", async () => {
    await POST(upload());
    const where = h.aggregates[0]!.where as { patientId: { in: string[] } };
    expect(where.patientId.in).toEqual(["p_owner", "p_mother"]);
  });

  it("over the day's volume: 429 upload_daily_quota with Retry-After, nothing stored", async () => {
    h.dayBytes = MINIAPP_UPLOAD_BYTES_PER_DAY - 1 * MB;
    const res = await POST(upload(2 * MB));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await res.json()).reason).toBe("upload_daily_quota");
    expect(h.uploads).toBe(0);
  });

  it("already at the day's volume: refused before the body is read", async () => {
    h.dayBytes = MINIAPP_UPLOAD_BYTES_PER_DAY;
    const res = await POST(upload());
    expect(res.status).toBe(429);
    expect(h.formDataCalls).toBe(0);
  });

  it("a body declared bigger than one file is 413 without reading it", async () => {
    const res = await POST(upload(1 * MB, { "content-length": String(30 * MB) }));
    expect(res.status).toBe(413);
    expect(h.formDataCalls).toBe(0);
  });

  it("G1-03: the upload's audit row carries the clinic and the patient", async () => {
    await POST(upload());
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!.actor).toMatchObject({ clinicId: "c1", patientId: "p_owner" });
    expect(h.audits[0]!.input.action).toBe("MINIAPP_DOCUMENT_UPLOADED");
  });
});

describe("what the patient reads", () => {
  for (const [lang, dict] of [["ru", ruDict], ["uz", uzDict]] as const) {
    it(`${lang}: each refusal has its own advice`, () => {
      const d = dict.documents;
      expect(uploadErrorText({ status: 429, data: { reason: "upload_rate_limited" } }, d)).toBe(d.uploadErrorRateLimited);
      expect(uploadErrorText({ status: 429, data: { reason: "upload_daily_quota" } }, d)).toBe(d.uploadErrorDailyQuota);
      expect(uploadErrorText({ status: 429, data: { reason: "upload_total_quota" } }, d)).toBe(d.uploadErrorTotalQuota);
      // nginx's own 429 has no JSON body.
      expect(uploadErrorText({ status: 429, data: null }, d)).toBe(d.uploadErrorRateLimited);
      expect(uploadErrorText({ status: 413 }, d)).toBe(d.uploadErrorTooLarge);
      expect(uploadErrorText(new Error("x"), d)).toBe(d.uploadErrorGeneric);
      for (const text of [d.uploadErrorRateLimited, d.uploadErrorDailyQuota, d.uploadErrorTotalQuota]) {
        expect(text).not.toMatch(/[—–]/);
      }
    });
  }
});

describe("in front of the app", () => {
  it("nginx slows upload floods per address and refuses oversize bodies on that path", () => {
    const conf = readFileSync(path.join(process.cwd(), "nginx/nginx.conf"), "utf8");
    expect(conf).toMatch(/limit_req_zone \$miniapp_upload_key zone=miniapp_upload:10m rate=20r\/m;/);
    // POST only: the document list is never throttled.
    expect(conf).toMatch(/map \$request_method \$miniapp_upload_key \{\s*POST\s+\$binary_remote_addr;\s*default\s+"";/);
    const loc = conf.slice(conf.indexOf("location = /api/miniapp/documents {"));
    const block = loc.slice(0, loc.indexOf("}"));
    expect(block).toContain("limit_req               zone=miniapp_upload");
    expect(block).toContain("limit_req_status        429;");
    expect(block).toContain("client_max_body_size    11m;");
    expect(block).toContain("proxy_set_header        X-Real-IP         $remote_addr;");
  });

  it("the watchdog alerts once when the disk fills and once when space is back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wd-"));
    mkdirSync(path.join(dir, "ops"));
    mkdirSync(path.join(dir, "bin"));
    const script = path.join(dir, "ops", "watchdog.sh");
    copyFileSync(path.join(process.cwd(), "ops/watchdog.sh"), script);
    const sent = path.join(dir, "sent.log");
    // curl: the health probe answers healthy; a Telegram send is recorded.
    writeFileSync(
      path.join(dir, "bin", "curl"),
      `#!/usr/bin/env bash
for a in "$@"; do case "$a" in *api.telegram.org*) echo SEND >> "${sent}"; printf '%s\\n' "$*" >> "${sent}.text"; exit 0;; esac; done
printf '{"db":{"status":"ok"},"redis":{"status":"ok"},"minio":{"status":"ok"},"workers":{"status":"ok"}}\\n200'
`,
    );
    writeFileSync(
      path.join(dir, "bin", "df"),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/sda1 100 0 0 %s%% /\\n' "$DF_PCT"
`,
    );
    chmodSync(path.join(dir, "bin", "curl"), 0o755);
    chmodSync(path.join(dir, "bin", "df"), 0o755);
    const run = (pct: number) =>
      spawnSync("bash", [script], {
        encoding: "utf8",
        env: {
          PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
          DF_PCT: String(pct),
          WATCHDOG_STATE: path.join(dir, "health.state"),
          WATCHDOG_DISK_STATE: path.join(dir, "disk.state"),
          WATCHDOG_TG_CHAT_ID: "42",
          TELEGRAM_BOT_TOKEN: "t",
          NODE_ENV: "test",
        },
      });
    const sends = () => (existsSync(sent) ? readFileSync(sent, "utf8").trim().split("\n").filter(Boolean) : []);
    const texts = () => (existsSync(`${sent}.text`) ? readFileSync(`${sent}.text`, "utf8") : "");

    expect(run(60).status).toBe(0);
    expect(sends()).toHaveLength(0);
    run(91);
    expect(sends()).toHaveLength(1);
    expect(texts()).toContain("91%");
    run(93);
    expect(sends()).toHaveLength(1);
    run(70);
    expect(sends()).toHaveLength(2);
    expect(readFileSync(path.join(dir, "disk.state"), "utf8").trim()).toBe("ok");
    // The health state never moved: one alert does not swallow the other.
    expect(existsSync(path.join(dir, "health.state"))).toBe(false);
  });
});

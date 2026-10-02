/**
 * Audit G1-13 — the backstop for uploads whose document was never saved.
 * The dialogs take such bytes back when they can, but not when the session
 * expired (the clean-up call is refused too) or the tab was closed. The
 * operator's report lists, and with APPLY=1 deletes, documents-folder
 * objects older than a day that no stored URL names.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ORPHAN_MIN_AGE_MS,
  findOrphanDocumentObjects,
  isDocumentObjectKey,
  loadDocumentFileReferences,
} from "@/server/documents/orphan-files";
import { listObjects, uploadObject } from "@/server/storage/minio";

const NOW = new Date("2026-10-02T12:00:00Z");
const OLD = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 60_000);
const FRESH = new Date(NOW.getTime() - 10 * 60_000);

const key = (name: string) => `clinics/c1/documents/${name}`;
const obj = (k: string, lastModified: Date | null = OLD) => ({
  key: k,
  lastModified,
  size: 100,
});

describe("isDocumentObjectKey", () => {
  it("is the upload routes' folder and nothing else", () => {
    expect(isDocumentObjectKey("clinics/c1/documents/a-scan.pdf")).toBe(true);
    expect(isDocumentObjectKey("clinics/shared/documents/a.pdf")).toBe(true);
    expect(isDocumentObjectKey("clinics/c1/conclusions/vn/r1-1.pdf")).toBe(false);
    expect(isDocumentObjectKey("clinics/c1/chat/conv/a.jpg")).toBe(false);
    expect(isDocumentObjectKey("clinics/c1/documents/")).toBe(false);
    expect(isDocumentObjectKey("drugs/c1/documents/a.pdf")).toBe(false);
  });
});

describe("findOrphanDocumentObjects", () => {
  it("reports an old upload nothing names, and only that", () => {
    const orphans = findOrphanDocumentObjects({
      objects: [
        obj(key("orphan-scan.pdf")),
        obj(key("fresh.pdf"), FRESH),
        obj(key("no-timestamp.pdf"), null),
        obj("clinics/c1/conclusions/vn_1/r0-1.pdf"),
        obj(key("minio.pdf")),
        obj(key("proxy file.pdf")),
        obj(key("stub.pdf")),
        obj(key("snapshot-sig.png")),
        obj(key("in-chat.jpg")),
      ],
      references: [
        `https://neurofax.uz/files/medbook/${key("minio.pdf")}`,
        `/api/crm/documents/file?key=${encodeURIComponent(key("proxy file.pdf"))}`,
        `file:///tmp/medbook-uploads/medbook/${key("stub.pdf")}`,
        // A replaced signature still printed on an issued prescription.
        `https://neurofax.uz/files/medbook/${key("snapshot-sig.png")}`,
        JSON.stringify([{ url: `x?key=${key("in-chat.jpg")}`, kind: "image" }]),
      ],
      now: NOW,
    });
    expect(orphans.map((o) => o.key)).toEqual([key("orphan-scan.pdf")]);
  });

  it("an upload whose receipt could still be used is never reported", () => {
    const justUnder = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS + 1);
    expect(
      findOrphanDocumentObjects({
        objects: [obj(key("a.pdf"), justUnder)],
        references: [],
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("loadDocumentFileReferences", () => {
  it("reads every column a documents-folder file can end up in", async () => {
    const rows = <T,>(...r: T[]) => async () => r;
    const db = {
      document: { findMany: rows({ fileUrl: "doc-url" }) },
      doctor: { findMany: rows({ signatureUrl: "sig-url", photoUrl: null }) },
      ePrescription: { findMany: rows({ signatureUrl: "rx-sig" }) },
      sickLeave: { findMany: rows({ signatureUrl: "sl-sig" }) },
      user: { findMany: rows({ photoUrl: "user-photo" }) },
      patient: { findMany: rows({ photoUrl: "patient-photo" }) },
      labResult: { findMany: rows({ attachmentUrl: "lab" }) },
      payment: { findMany: rows({ receiptUrl: "receipt" }) },
      invoice: { findMany: rows({ pdfUrl: "invoice" }) },
      clinic: { findMany: rows({ logoUrl: "logo", letterheadUrl: null }) },
      message: { findMany: rows({ attachments: [{ url: "chat" }] }) },
    } as never;
    expect(await loadDocumentFileReferences(db)).toEqual([
      "doc-url",
      "sig-url",
      "rx-sig",
      "sl-sig",
      "user-photo",
      "patient-photo",
      "lab",
      "receipt",
      "invoice",
      "logo",
      JSON.stringify([{ url: "chat" }]),
    ]);
  });
});

describe("listObjects (stub storage)", () => {
  const bucket = `g113-${randomUUID()}`;
  afterAll(() => {
    rmSync(path.join(tmpdir(), "medbook-uploads", bucket), {
      recursive: true,
      force: true,
    });
  });

  it("lists every object under the prefix with its age", async () => {
    if (process.env.MINIO_ENDPOINT) return; // only the stub is local
    await uploadObject(bucket, key("a.pdf"), Buffer.from("a"), "application/pdf");
    await uploadObject(bucket, "clinics/c2/documents/b.png", Buffer.from("bb"), "image/png");
    await uploadObject(bucket, "drugs/c1/x.jpg", Buffer.from("x"), "image/jpeg");
    const listed = await listObjects(bucket, "clinics/");
    expect(listed.map((o) => o.key).sort()).toEqual([
      "clinics/c1/documents/a.pdf",
      "clinics/c2/documents/b.png",
    ]);
    expect(listed.every((o) => o.lastModified instanceof Date)).toBe(true);
    expect(listed.find((o) => o.key.endsWith("b.png"))?.size).toBe(2);
    expect(await listObjects(`${bucket}-missing`, "clinics/")).toEqual([]);
  });
});

describe("the operator script", () => {
  const scripts = path.resolve(__dirname, "../../scripts");
  const src = readFileSync(path.join(scripts, "fix-g1-13-orphan-document-files.ts"), "utf8");

  it("is a dry run unless APPLY=1, and ships in the worker image", () => {
    expect(src).toMatch(/const APPLY = process\.env\.APPLY === "1";/);
    expect(src).toMatch(/if \(!APPLY\) \{[\s\S]*?return;/);
    expect(existsSync(path.join(scripts, "fix-g1-13-orphan-document-files.ts"))).toBe(true);
    expect(readFileSync(path.join(scripts, "worker-allowlist.txt"), "utf8")).toMatch(
      /^fix-g1-13-orphan-document-files\.ts$/m,
    );
  });

  it("lists storage before reading the rows", () => {
    expect(src.indexOf("listObjects(")).toBeLessThan(
      src.indexOf("loadDocumentFileReferences(prisma)"),
    );
  });
});

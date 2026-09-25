import { describe, expect, it } from "vitest";

import {
  DOCUMENT_TYPES,
  OFFICE_TYPES,
  TEXT_TYPES,
  checkUpload,
  safeFileHeaders,
  sniffMime,
} from "@/server/storage/safe-file";

/**
 * Audit CD-01: an SVG «photo» from the Mini App or an .html «document» was
 * stored with the client's Content-Type and served inline from neurofax.uz,
 * so its script ran with the receptionist's session. Uploads are now typed
 * by their bytes and served back only as inert types.
 */

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );

const PDF = bytes("%PDF-1.7\n");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0]);
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = bytes("<!doctype html><script>fetch('/api/crm/patients')</script>");
const DOCX = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0]);

describe("sniffMime", () => {
  it("recognises the formats patients and staff actually upload", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(WEBP)).toBe("image/webp");
    expect(sniffMime(HEIC)).toBe("image/heic");
  });

  it("does not recognise script carriers at all", () => {
    expect(sniffMime(SVG)).toBeNull();
    expect(sniffMime(HTML)).toBeNull();
  });
});

describe("checkUpload", () => {
  it("rejects an SVG and HTML whatever the browser claims", () => {
    expect(checkUpload(SVG, "image/svg+xml", DOCUMENT_TYPES).ok).toBe(false);
    expect(checkUpload(HTML, "image/png", DOCUMENT_TYPES).ok).toBe(false);
    expect(checkUpload(HTML, "application/pdf", DOCUMENT_TYPES).ok).toBe(false);
  });

  it("stores the sniffed type, not the declared one", () => {
    expect(checkUpload(PNG, "image/svg+xml", DOCUMENT_TYPES)).toEqual({
      ok: true,
      mime: "image/png",
    });
  });

  it("refuses a real file of a type the caller does not allow", () => {
    expect(checkUpload(PDF, "application/pdf", ["image/jpeg"]).ok).toBe(false);
  });

  it("keeps the declared office type for zip-based documents", () => {
    const docx =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(checkUpload(DOCX, docx, [...OFFICE_TYPES])).toEqual({ ok: true, mime: docx });
    expect(checkUpload(DOCX, docx, DOCUMENT_TYPES).ok).toBe(false);
  });

  it("takes plain text only when allowed, and never binary disguised as text", () => {
    const txt = bytes("Анализы в норме\n");
    expect(checkUpload(txt, "text/plain", [...TEXT_TYPES]).ok).toBe(true);
    expect(checkUpload(txt, "text/plain", DOCUMENT_TYPES).ok).toBe(false);
    expect(checkUpload(bytes("ab", [0], "cd"), "text/plain", [...TEXT_TYPES]).ok).toBe(false);
  });
});

describe("safeFileHeaders", () => {
  it("serves an old stored SVG as an inert download", () => {
    const h = safeFileHeaders("image/svg+xml", { filename: "a.svg" });
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["Content-Disposition"].startsWith("attachment")).toBe(true);
    expect(h["Content-Security-Policy"]).toContain("sandbox");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("serves HTML and text as downloads too", () => {
    for (const t of ["text/html", "text/plain", "application/xml", undefined]) {
      expect(safeFileHeaders(t, { filename: "x" })["Content-Disposition"]).toMatch(/^attachment/);
    }
  });

  it("lets PDFs and photos preview inline", () => {
    expect(safeFileHeaders("application/pdf", { filename: "a.pdf" })["Content-Disposition"]).toMatch(/^inline/);
    expect(safeFileHeaders("image/jpeg", { filename: "a.jpg" })["Content-Disposition"]).toMatch(/^inline/);
  });

  it("does not sandbox PDFs (Chrome will not show a sandboxed PDF)", () => {
    expect(safeFileHeaders("application/pdf", { filename: "a.pdf" })["Content-Security-Policy"]).toBeUndefined();
  });

  it("honours ?download and non-ASCII names", () => {
    const h = safeFileHeaders("image/png", { download: true, filename: "Анализ.png" });
    expect(h["Content-Disposition"]).toMatch(/^attachment/);
    expect(h["Content-Disposition"]).toContain("filename*=UTF-8''");
  });
});

describe("what real clinics upload", () => {
  it("serves zip and office files with their real type, as downloads", () => {
    const h = safeFileHeaders("application/zip", { filename: "scans.zip" });
    expect(h["Content-Type"]).toBe("application/zip");
    expect(h["Content-Disposition"]).toMatch(/^attachment/);
  });

  it("previews old uploads stored under legacy spellings", () => {
    expect(safeFileHeaders("application/x-pdf", { filename: "a.pdf" })["Content-Disposition"]).toMatch(/^inline/);
    expect(safeFileHeaders("image/jpg", { filename: "a.jpg" })["Content-Type"]).toBe("image/jpeg");
  });

  it("accepts a Windows .csv labelled as an Excel file, as text", () => {
    const csv = bytes("фамилия;дата\nИванов;01.09\n");
    expect(
      checkUpload(csv, "application/vnd.ms-excel", [...TEXT_TYPES], "список.csv"),
    ).toEqual({ ok: true, mime: "text/csv" });
  });

  it("recognises RTF, AVIF, BMP, TIFF and a PDF with a short preamble", () => {
    expect(sniffMime(bytes("{\\rtf1\\ansi hello}"))).toBe("application/rtf");
    expect(sniffMime(bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0]))).toBe("image/avif");
    expect(sniffMime(bytes("BM", new Array(40).fill(0)))).toBe("image/bmp");
    expect(sniffMime(bytes([0x49, 0x49, 0x2a, 0x00, 8, 0]))).toBe("image/tiff");
    expect(sniffMime(bytes([0xef, 0xbb, 0xbf], "\n%PDF-1.4\n"))).toBe("application/pdf");
  });

  it("does not mistake UTF-16 text for an MP3", () => {
    expect(sniffMime(bytes([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toBeNull();
  });
});

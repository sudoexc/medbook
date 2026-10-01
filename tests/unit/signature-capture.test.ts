/**
 * Audit CD-05: the patient card's signature pad never saved.
 *
 * It put `canvas.toDataURL()` of a 900×440 canvas into `Document.fileUrl`:
 * tens of thousands of base64 characters against a 1000-character limit, so
 * every save was a 400. Now the PNG is uploaded like any file, with the
 * upload taken back if the document cannot be saved.
 *
 * Only a signature that signs one of the patient's pending consents is filed
 * as a (signed) consent. With none picked it is «Прочее», unsigned: a bare
 * «signed consent» could be deleted by nobody, not even when it was a test
 * scribble on the wrong patient's card (review finding).
 */
import { describe, expect, it, vi } from "vitest";

import { CreateDocumentSchema } from "@/server/schemas/document";
import {
  canvasToPngFile,
  saveSignature,
  SIGNATURE_MIME,
  type SignatureCanvas,
  type SignatureDocumentInput,
} from "@/lib/signature-capture";
import { checkDocumentFileUrl } from "@/server/documents/file-ref";

/** A 900×440 canvas with a stroke: a PNG of tens of kilobytes. */
function fakeCanvas(bytes = 48_000): SignatureCanvas & { width: number; height: number } {
  return {
    width: 900,
    height: 440,
    toBlob(cb, type) {
      cb(new Blob([new Uint8Array(bytes)], { type: type ?? "image/png" }));
    },
  };
}

const KEY = "clinics/c1/documents/abc-signature-2026-10-01.png";
const STORED = {
  fileUrl: `https://neurofax.uz/files/medbook/${KEY}`,
  uploadToken: "receipt",
  mimeType: "image/png",
  sizeBytes: 48_000,
};

describe("the old inline save (why it always failed)", () => {
  it("a data: URL of the pad's PNG does not fit fileUrl and is refused as a file", () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(new Uint8Array(48_000)).toString("base64")}`;
    expect(dataUrl.length).toBeGreaterThan(1000);
    const parsed = CreateDocumentSchema.safeParse({
      patientId: "p1",
      type: "CONSENT",
      title: "Подпись",
      fileUrl: dataUrl,
      mimeType: "image/png",
    });
    expect(parsed.success).toBe(false);
    // Nor would a short one be accepted any more: no data: value is a file.
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: "data:image/png;base64,AAAA" }).ok).toBe(false);
  });
});

describe("saveSignature", () => {
  it("uploads the 900×440 PNG; with no consent picked it is filed as an unsigned «Прочее»", async () => {
    const uploaded: File[] = [];
    const docs: SignatureDocumentInput[] = [];
    const discard = vi.fn(async () => undefined);
    await saveSignature({
      canvas: fakeCanvas(),
      patientId: "p1",
      title: "Подпись пациента 01.10.2026",
      fileName: "signature-2026-10-01.png",
      upload: async (file) => {
        uploaded.push(file);
        return STORED;
      },
      createDocument: async (doc) => {
        docs.push(doc);
      },
      discardUpload: discard,
    });

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.type).toBe(SIGNATURE_MIME);
    expect(uploaded[0]!.size).toBe(48_000);
    expect(uploaded[0]!.name).toBe("signature-2026-10-01.png");

    expect(docs).toEqual([
      {
        patientId: "p1",
        type: "OTHER",
        title: "Подпись пациента 01.10.2026",
        fileUrl: STORED.fileUrl,
        uploadToken: "receipt",
        mimeType: "image/png",
        sizeBytes: 48_000,
        signsDocumentId: null,
      },
    ]);
    // What the pad sends now passes the API's schema.
    expect(CreateDocumentSchema.safeParse(docs[0]).success).toBe(true);
    expect(discard).not.toHaveBeenCalled();
  });

  it("names the consent it signs, and only then is filed as a consent", async () => {
    const docs: SignatureDocumentInput[] = [];
    await saveSignature({
      canvas: fakeCanvas(),
      patientId: "p1",
      title: "Подпись: Согласие",
      fileName: "s.png",
      signsDocumentId: "consent1",
      upload: async () => STORED,
      createDocument: async (doc) => {
        docs.push(doc);
      },
      discardUpload: async () => undefined,
    });
    expect(docs[0]).toMatchObject({ type: "CONSENT", signsDocumentId: "consent1" });
    expect(CreateDocumentSchema.safeParse(docs[0]).success).toBe(true);
  });

  it("takes the upload back and rethrows when the document is refused", async () => {
    const discard = vi.fn(async () => undefined);
    const refusal = Object.assign(new Error("BadRequest"), { reason: "consent_not_signable" });
    await expect(
      saveSignature({
        canvas: fakeCanvas(),
        patientId: "p1",
        title: "Подпись",
        fileName: "s.png",
        upload: async () => STORED,
        createDocument: async () => {
          throw refusal;
        },
        discardUpload: discard,
      }),
    ).rejects.toBe(refusal);
    expect(discard).toHaveBeenCalledWith(STORED);
  });

  it("an empty canvas never reaches the upload", async () => {
    const upload = vi.fn(async () => STORED);
    await expect(
      canvasToPngFile({ toBlob: (cb) => cb(null) }, "s.png"),
    ).rejects.toThrow("signature_empty");
    await expect(
      saveSignature({
        canvas: { toBlob: (cb) => cb(new Blob([])) },
        patientId: "p1",
        title: "Подпись",
        fileName: "s.png",
        upload,
        createDocument: async () => undefined,
        discardUpload: async () => undefined,
      }),
    ).rejects.toThrow("signature_empty");
    expect(upload).not.toHaveBeenCalled();
  });
});

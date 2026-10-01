/**
 * Saving a signature drawn on the patient card's signature pad (audit CD-05).
 *
 * The pad used to put `canvas.toDataURL()` into `Document.fileUrl`. A
 * 900×440 PNG with a stroke is tens of kilobytes, so its base64 is tens of
 * thousands of characters against a 1000-character column: every save was
 * a 400, the dialog stayed open with a raw error code, and the clinic could
 * believe consents were being collected. Now the PNG goes through the upload
 * route like any other file, the document is filed as an already signed
 * consent, and, when the receptionist picked one, the unsigned consent it
 * belongs to is stamped signed in the same request.
 */
import type { UploadedDocumentFile } from "@/lib/document-upload-client";

export const SIGNATURE_MIME = "image/png";

/** The part of an `HTMLCanvasElement` the save needs (a fake in tests). */
export type SignatureCanvas = {
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

export function canvasToPngFile(
  canvas: SignatureCanvas,
  fileName: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0) {
        reject(new Error("signature_empty"));
        return;
      }
      resolve(new File([blob], fileName, { type: SIGNATURE_MIME }));
    }, SIGNATURE_MIME);
  });
}

/** Body of `POST /api/crm/documents` for a captured signature. */
export type SignatureDocumentInput = {
  patientId: string;
  type: "CONSENT";
  title: string;
  fileUrl: string;
  uploadToken: string | null;
  mimeType: string;
  sizeBytes: number | null;
  signed: true;
  signsDocumentId: string | null;
};

export async function saveSignature(input: {
  canvas: SignatureCanvas;
  patientId: string;
  title: string;
  fileName: string;
  /** The unsigned consent or contract this signature signs, if any. */
  signsDocumentId?: string | null;
  upload: (file: File) => Promise<UploadedDocumentFile>;
  createDocument: (doc: SignatureDocumentInput) => Promise<unknown>;
  discardUpload: (file: UploadedDocumentFile) => Promise<unknown>;
}): Promise<void> {
  const file = await canvasToPngFile(input.canvas, input.fileName);
  const uploaded = await input.upload(file);
  try {
    await input.createDocument({
      patientId: input.patientId,
      type: "CONSENT",
      title: input.title,
      fileUrl: uploaded.fileUrl,
      uploadToken: uploaded.uploadToken,
      mimeType: uploaded.mimeType ?? SIGNATURE_MIME,
      sizeBytes: uploaded.sizeBytes ?? file.size,
      signed: true,
      signsDocumentId: input.signsDocumentId ?? null,
    });
  } catch (e) {
    // The bytes are stored but nothing points at them: take them back so
    // a failed save leaves no orphan in the bucket (CM-05).
    await input.discardUpload(uploaded).catch(() => undefined);
    throw e;
  }
}

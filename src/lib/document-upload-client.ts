/**
 * Browser side of `POST/DELETE /api/crm/documents/upload`: store a file's
 * bytes and get back the URL plus the receipt a document needs (audit
 * CD-08), or take back bytes whose document was never saved (CM-05).
 * Shared by the patient card (uploads and the signature pad) and the
 * documents library, so they cannot drift.
 */

export type UploadedDocumentFile = {
  fileUrl: string;
  uploadToken: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export async function uploadDocumentFile(
  file: File,
  patientId?: string,
): Promise<UploadedDocumentFile> {
  const fd = new FormData();
  fd.append("file", file);
  if (patientId) fd.append("patientId", patientId);
  const res = await fetch("/api/crm/documents/upload", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    let detail = `upload HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // ignore non-json error bodies
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as {
    fileUrl: string;
    uploadToken?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
  };
  return {
    fileUrl: data.fileUrl,
    uploadToken: data.uploadToken ?? null,
    mimeType: data.mimeType ?? null,
    sizeBytes: data.sizeBytes ?? null,
  };
}

/**
 * Take back bytes whose document was not saved. Best effort: a failure
 * here leaves the object as it was before this fix, never breaks the dialog.
 */
export async function discardDocumentUpload(
  fileUrl: string,
  uploadToken: string | null,
): Promise<void> {
  if (!uploadToken) return;
  try {
    await fetch("/api/crm/documents/upload", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fileUrl, uploadToken }),
    });
  } catch {
    // ignore: see above
  }
}

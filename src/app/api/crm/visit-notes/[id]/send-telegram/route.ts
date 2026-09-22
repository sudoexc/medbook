/**
 * POST /api/crm/visit-notes/[id]/send-telegram — push everything this visit
 * produced into the patient's Telegram chat, on demand.
 *
 * The finalize worker already delivers the conclusion automatically, but only
 * if the patient was linked at that moment. The clinic's actual flow is the
 * reverse: the patient links up right in the cabinet (QR on the doctor's
 * screen → /start) AFTER the visit, and then the doctor wants one button that
 * sends the papers. This route is that button.
 *
 * Files go as real uploads (multipart via `sendDocument`), never as links —
 * the MinIO bucket is private and presigned URLs are forbidden here (see
 * `docs/security`, the /files/ rewrite breaks them). Bytes are streamed out of
 * storage and re-uploaded to Telegram.
 *
 * DOCTOR may send only for his own visit; reception/admin for any. 409s carry
 * a machine `reason` so the UI can switch to the QR-link dialog instead of
 * showing a dead error.
 */
import path from "node:path";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, forbidden } from "@/server/http";
import { fetchObject } from "@/server/storage/minio";
import { sendDocument } from "@/server/telegram/send";

/** Telegram caps media groups; ten is plenty for one visit's paperwork. */
const MAX_DOCS = 10;

/**
 * `Document.fileUrl` is a public-shaped URL over the private bucket:
 *   https://<host>/files/<bucket>/<key…>
 * Returns bucket + key, or null for anything that doesn't match — a document
 * with a foreign/malformed URL must be skipped, not guessed at.
 */
export function storageRefFromFileUrl(
  fileUrl: string,
): { bucket: string; key: string } | null {
  let pathname: string;
  try {
    pathname = new URL(fileUrl).pathname;
  } catch {
    return null;
  }
  const m = pathname.match(/^\/files\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const bucket = decodeURIComponent(m[1]!);
  const key = decodeURIComponent(m[2]!);
  if (!key || key.includes("..")) return null;
  return { bucket, key };
}

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("send-telegram");
  return idx > 0 ? (parts[idx - 1] ?? "") : "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    const noteId = idFromUrl(request);
    if (!noteId) return err("BadRequest", 400);

    const note = await prisma.visitNote.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        doctorId: true,
        appointmentId: true,
        patient: {
          select: { id: true, fullName: true, telegramId: true },
        },
        clinic: {
          select: {
            id: true,
            slug: true,
            tgBotToken: true,
            tgBotUsername: true,
          },
        },
        // Packaging photos for the prescribed drugs — the patient gets the
        // box picture next to the paperwork and recognises it at the counter.
        visitPrescriptions: {
          orderBy: { sortOrder: "asc" },
          select: {
            displayName: true,
            drug: { select: { photoUrl: true } },
          },
        },
      },
    });
    if (!note) return notFound();

    // A doctor pushes documents for his own visits only — same session-derived
    // guard as walk-in and booking, so the three entry points cannot drift.
    if (ctx.role === "DOCTOR") {
      const self = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!self || self.id !== note.doctorId) return forbidden();
    }

    if (!note.clinic.tgBotToken) {
      return err("BotNotConfigured", 409, { reason: "bot_not_configured" });
    }
    if (!note.patient.telegramId) {
      // The UI flips to the QR-link dialog on this reason.
      return err("PatientNotLinked", 409, { reason: "not_linked" });
    }

    // Everything the visit produced: the rendered conclusion (visitNoteId) and
    // any uploads attached to the appointment. One query, deduped by id.
    const documents = await prisma.document.findMany({
      where: {
        patientId: note.patient.id,
        OR: [
          { visitNoteId: note.id },
          ...(note.appointmentId
            ? [{ appointmentId: note.appointmentId }]
            : []),
        ],
      },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        mimeType: true,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_DOCS,
    });

    if (documents.length === 0) {
      return err("NothingToSend", 409, { reason: "nothing_to_send" });
    }

    const sent: string[] = [];
    const failed: string[] = [];

    for (const doc of documents) {
      const ref = storageRefFromFileUrl(doc.fileUrl);
      if (!ref) {
        failed.push(doc.id);
        continue;
      }
      try {
        const obj = await fetchObject(ref.bucket, ref.key);
        if (!obj.body) throw new Error("empty body");
        const bytes = Buffer.from(await new Response(obj.body).arrayBuffer());
        await sendDocument(note.clinic, note.patient.telegramId, bytes, {
          filename: path.basename(ref.key),
          contentType:
            doc.mimeType ?? obj.contentType ?? "application/octet-stream",
          caption: doc.title,
        });
        sent.push(doc.id);
      } catch (e) {
        // Keep going: one unreadable file must not block the rest of the
        // visit's paperwork. The counts in the response tell the truth.
        console.warn(
          `[send-telegram] doc ${doc.id} failed: ${(e as Error).message}`,
        );
        failed.push(doc.id);
      }
    }

    // Pack shots after the documents: the paperwork is the point, the
    // pictures are the help. Failures here never spoil the send — the
    // patient already has everything that matters.
    let packsSent = 0;
    for (const rx of note.visitPrescriptions) {
      const photo = rx.drug?.photoUrl;
      if (!photo) continue;
      const ref = storageRefFromFileUrl(photo);
      if (!ref) continue;
      try {
        const obj = await fetchObject(ref.bucket, ref.key);
        if (!obj.body) continue;
        const bytes = Buffer.from(await new Response(obj.body).arrayBuffer());
        await sendDocument(note.clinic, note.patient.telegramId, bytes, {
          filename: path.basename(ref.key),
          contentType: obj.contentType ?? "image/jpeg",
          caption: rx.displayName,
        });
        packsSent += 1;
      } catch (e) {
        console.warn(
          `[send-telegram] pack shot failed: ${(e as Error).message}`,
        );
      }
    }

    await audit(request, {
      action: "visit_note.documents_sent_telegram",
      entityType: "VisitNote",
      entityId: note.id,
      meta: {
        patientId: note.patient.id,
        sentDocumentIds: sent,
        failedDocumentIds: failed,
        packShotsSent: packsSent,
      },
    });

    if (sent.length === 0) {
      return err("SendFailed", 502, { reason: "send_failed", failed: failed.length });
    }
    return ok({ sent: sent.length, failed: failed.length });
  },
);

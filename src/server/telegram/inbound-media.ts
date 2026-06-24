/**
 * Inbound Telegram media → chat attachment ingestion.
 *
 * When a patient sends a photo / document / video from Telegram, the webhook
 * must download the bytes (the `file_id` is meaningless to our UI and the TG
 * download URL is short-lived ~1h) and re-host them so both the CRM operator
 * bubble and the patient's Mini-App bubble can render them.
 *
 * We re-use the exact same storage key + capability-URL scheme as the OUTBOUND
 * upload route (`/api/crm/conversations/[id]/attachments`): the object lands at
 * `clinics/<clinic>/chat/<conversation>/<uuid>.<ext>` and the persisted URL is
 * the streaming proxy `…/attachments/file?key=…`. The bucket is private, so a
 * bare MinIO URL would 403 — see `feedback`/route header comments.
 *
 * Returns the attachment(s) to persist on the Message (0 or 1 — Telegram sends
 * one media per message; albums arrive as separate messages).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isStubMode, uploadObject } from "@/server/storage/minio";
import { chatExtFor } from "@/lib/chat-attachments";

import { getFile, buildFileDownloadUrl } from "./bot-api";
import type { TgClinicMinimal } from "./send";

export type InboundAttachment = {
  kind: "image" | "file";
  url: string;
  mimeType?: string;
  name?: string;
  sizeBytes?: number;
};

type TgPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
};
type TgDocumentLike = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TgMediaMessage = {
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  animation?: unknown;
};

/** One media descriptor extracted from a TG message, normalised. */
type MediaPick = {
  fileId: string;
  mime: string;
  name?: string;
  sizeBytes?: number;
};

function asDocumentLike(x: unknown): TgDocumentLike | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  return typeof o.file_id === "string" ? (o as TgDocumentLike) : null;
}

/** Choose the single media object to ingest, preferring richest visual. */
function pickMedia(msg: TgMediaMessage): MediaPick | null {
  // Photo: an array of sizes ascending — take the largest (last).
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const sizes = msg.photo as TgPhotoSize[];
    const largest = sizes[sizes.length - 1];
    if (largest && typeof largest.file_id === "string") {
      return {
        fileId: largest.file_id,
        mime: "image/jpeg",
        name: "photo.jpg",
        sizeBytes: largest.file_size,
      };
    }
  }
  const doc = asDocumentLike(msg.document);
  if (doc) {
    return {
      fileId: doc.file_id,
      mime: doc.mime_type || "application/octet-stream",
      name: doc.file_name,
      sizeBytes: doc.file_size,
    };
  }
  const video = asDocumentLike(msg.video) ?? asDocumentLike(msg.animation);
  if (video) {
    return {
      fileId: video.file_id,
      mime: video.mime_type || "video/mp4",
      name: video.file_name,
      sizeBytes: video.file_size,
    };
  }
  return null;
}

function extFor(mime: string, name?: string): string {
  const fromHelper = chatExtFor(mime, name);
  if (fromHelper !== "bin") return fromHelper;
  const sub = mime.split("/")[1];
  const cleaned = sub ? sub.replace(/[^a-z0-9]/gi, "").slice(0, 8) : "";
  return cleaned || "bin";
}

/**
 * Download any inbound media in `msg` and re-host it as a chat attachment.
 * Best-effort: on any failure we log and return [] so the message still
 * records (just without the attachment) rather than failing the webhook.
 */
export async function ingestTelegramMedia(
  clinic: TgClinicMinimal,
  conversationId: string,
  msg: TgMediaMessage,
): Promise<InboundAttachment[]> {
  const pick = pickMedia(msg);
  if (!pick) return [];
  if (!clinic.tgBotToken) return [];

  try {
    const fileResp = await getFile(clinic.tgBotToken, pick.fileId);
    if (!fileResp.ok || !fileResp.result.file_path) {
      throw new Error(
        fileResp.ok
          ? "getFile returned no file_path"
          : `getFile ${fileResp.error_code}: ${fileResp.description}`,
      );
    }
    const downloadUrl = buildFileDownloadUrl(
      clinic.tgBotToken,
      fileResp.result.file_path,
    );
    const res = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("empty download");

    const ext = extFor(pick.mime, pick.name);
    const id = randomUUID();
    const fileName = `${id}.${ext}`;
    const key = `clinics/${clinic.id}/chat/${conversationId}/${fileName}`;
    const displayName = pick.name || fileName;
    const kind: InboundAttachment["kind"] = pick.mime.startsWith("image/")
      ? "image"
      : "file";

    let url: string;
    if (isStubMode()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "chat",
        clinic.id,
        conversationId,
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, fileName), buffer);
      url = `/uploads/chat/${clinic.id}/${conversationId}/${fileName}`;
    } else {
      await uploadObject(undefined, key, buffer, pick.mime);
      const q = new URLSearchParams({ key, name: displayName });
      url = `/api/crm/conversations/${conversationId}/attachments/file?${q.toString()}`;
    }

    return [
      {
        kind,
        url,
        mimeType: pick.mime,
        name: displayName,
        sizeBytes: pick.sizeBytes ?? buffer.byteLength,
      },
    ];
  } catch (e) {
    console.warn(
      `[tg:inbound-media] ingest failed conv=${conversationId}: ${(e as Error).message}`,
    );
    return [];
  }
}

/** Short preview label for a conversation list / realtime event. */
export function mediaPreviewLabel(attachments: InboundAttachment[]): string {
  if (attachments.length === 0) return "";
  const a = attachments[0];
  if (a.kind === "image") return "📷 Фото";
  if (a.mimeType?.startsWith("video/")) return "🎬 Видео";
  return a.name ? `📎 ${a.name}` : "📎 Файл";
}

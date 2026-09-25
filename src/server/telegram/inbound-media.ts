/**
 * Inbound Telegram media → chat attachment ingestion.
 *
 * When a patient sends a photo / document / video from Telegram, the webhook
 * must download the bytes (the `file_id` is meaningless to our UI and the TG
 * download URL is short-lived ~1h) and re-host them so both the CRM operator
 * bubble and the patient's Mini-App bubble can render them.
 *
 * Voice notes, audio, round video notes and stickers are media too (audit
 * TG-01). For many patients a voice note IS the message («после вашего
 * препарата кружится голова»), so dropping it left reception with an empty
 * «Без текста» bubble and nothing to play. They are ingested the same way;
 * `tgType` tells the bubble which player and label to use. A shared location
 * carries no file, so it becomes plain text (`inboundLocationText`).
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
import { sniffMime } from "@/server/storage/safe-file";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isStubMode, uploadObject } from "@/server/storage/minio";
import { chatExtFor } from "@/lib/chat-attachments";

import { getFile, buildFileDownloadUrl } from "./bot-api";
import type { TgClinicMinimal } from "./send";

/** What Telegram called the media, so the bubble can pick a player and label. */
export type TgMediaType =
  | "photo"
  | "document"
  | "video"
  | "animation"
  | "voice"
  | "audio"
  | "video_note"
  | "sticker";

export type InboundAttachment = {
  kind: "image" | "file";
  url: string;
  mimeType?: string;
  name?: string;
  sizeBytes?: number;
  tgType?: TgMediaType;
  /** Voice / audio / video length in seconds, as Telegram reported it. */
  durationSec?: number;
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
  duration?: number;
};
type TgSticker = TgDocumentLike & {
  emoji?: string;
  is_animated?: boolean;
  is_video?: boolean;
  thumbnail?: TgPhotoSize;
};

export type TgMediaMessage = {
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  animation?: unknown;
  voice?: unknown;
  audio?: unknown;
  video_note?: unknown;
  sticker?: unknown;
};

/** One media descriptor extracted from a TG message, normalised. */
type MediaPick = {
  fileId: string;
  mime: string;
  name?: string;
  sizeBytes?: number;
  tgType: TgMediaType;
  durationSec?: number;
};

/**
 * The Bot API's `getFile` refuses anything above 20 MB, so a bigger file can
 * never be fetched: don't try, the message keeps its preview label.
 */
const TG_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

function asDocumentLike(x: unknown): TgDocumentLike | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  return typeof o.file_id === "string" ? (o as TgDocumentLike) : null;
}

function duration(x: TgDocumentLike): number | undefined {
  return typeof x.duration === "number" && Number.isFinite(x.duration)
    ? x.duration
    : undefined;
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
        tgType: "photo",
      };
    }
  }
  const voice = asDocumentLike(msg.voice);
  if (voice) {
    // Telegram voice notes are Opus in an Ogg container.
    return {
      fileId: voice.file_id,
      mime: voice.mime_type || "audio/ogg",
      name: "voice.ogg",
      sizeBytes: voice.file_size,
      tgType: "voice",
      durationSec: duration(voice),
    };
  }
  const videoNote = asDocumentLike(msg.video_note);
  if (videoNote) {
    return {
      fileId: videoNote.file_id,
      mime: "video/mp4",
      name: "video-note.mp4",
      sizeBytes: videoNote.file_size,
      tgType: "video_note",
      durationSec: duration(videoNote),
    };
  }
  const audio = asDocumentLike(msg.audio);
  if (audio) {
    const a = audio as TgDocumentLike & { title?: string };
    return {
      fileId: a.file_id,
      mime: a.mime_type || "audio/mpeg",
      name: a.file_name || (a.title ? `${a.title}.mp3` : "audio.mp3"),
      sizeBytes: a.file_size,
      tgType: "audio",
      durationSec: duration(a),
    };
  }
  const sticker = asDocumentLike(msg.sticker) as TgSticker | null;
  if (sticker) {
    // A static sticker is a WebP image. Animated (.tgs, gzipped Lottie) and
    // video (.webm) ones render as their still thumbnail when Telegram gives
    // one; the CRM has no Lottie player and a looping sticker is noise.
    const still =
      (sticker.is_animated || sticker.is_video) &&
      sticker.thumbnail &&
      typeof sticker.thumbnail.file_id === "string"
        ? sticker.thumbnail
        : null;
    return still
      ? {
          fileId: still.file_id,
          mime: "image/webp",
          name: "sticker.webp",
          sizeBytes: still.file_size,
          tgType: "sticker",
        }
      : {
          fileId: sticker.file_id,
          mime: sticker.is_video
            ? "video/webm"
            : sticker.is_animated
              ? "application/octet-stream"
              : "image/webp",
          name: sticker.is_video
            ? "sticker.webm"
            : sticker.is_animated
              ? "sticker.tgs"
              : "sticker.webp",
          sizeBytes: sticker.file_size,
          tgType: "sticker",
        };
  }
  // An animation (GIF) also carries a `document` twin for old clients; the
  // animation descriptor is the one that says what it is.
  const animation = asDocumentLike(msg.animation);
  const video = animation ? null : asDocumentLike(msg.video);
  const moving = animation ?? video;
  if (moving) {
    return {
      fileId: moving.file_id,
      mime: moving.mime_type || "video/mp4",
      name: moving.file_name,
      sizeBytes: moving.file_size,
      tgType: animation ? "animation" : "video",
      durationSec: duration(moving),
    };
  }
  const doc = asDocumentLike(msg.document);
  if (doc) {
    return {
      fileId: doc.file_id,
      mime: doc.mime_type || "application/octet-stream",
      name: doc.file_name,
      sizeBytes: doc.file_size,
      tgType: "document",
    };
  }
  return null;
}

/** The kind of media a message carries, whether or not it could be fetched. */
export function inboundMediaType(msg: TgMediaMessage): TgMediaType | null {
  return pickMedia(msg)?.tgType ?? null;
}

type TgLocation = { latitude?: unknown; longitude?: unknown };
type TgVenue = { location?: TgLocation; title?: unknown; address?: unknown };

function coord(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(6) : null;
}

/**
 * A shared location (or venue) as chat text: coordinates plus a map link the
 * CRM bubble turns into a clickable URL. Telegram sends no file for these, so
 * without this the message was stored empty. Language-neutral on purpose:
 * the same row is read by RU and UZ staff.
 */
export function inboundLocationText(msg: {
  location?: unknown;
  venue?: unknown;
}): string | null {
  const venue =
    msg.venue && typeof msg.venue === "object" ? (msg.venue as TgVenue) : null;
  const loc =
    venue?.location ??
    (msg.location && typeof msg.location === "object"
      ? (msg.location as TgLocation)
      : null);
  if (!loc) return null;
  const lat = coord(loc.latitude);
  const lng = coord(loc.longitude);
  if (!lat || !lng) return null;
  const place = venue
    ? [venue.title, venue.address]
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .join(", ")
    : "";
  const lines = [
    place ? `📍 ${place}` : `📍 ${lat}, ${lng}`,
    ...(place ? [`${lat}, ${lng}`] : []),
    `https://maps.google.com/?q=${lat},${lng}`,
  ];
  return lines.join("\n");
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
  if ((pick.sizeBytes ?? 0) > TG_DOWNLOAD_MAX_BYTES) {
    console.warn(
      `[tg:inbound-media] ${pick.tgType} too large to fetch conv=${conversationId} bytes=${pick.sizeBytes}`,
    );
    return [];
  }

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

    // What the patient sent is typed by its bytes, not by the mime Telegram
    // relays from the sender's client: an SVG «photo» stored as image/svg+xml
    // would run script when reception opens it (audit CD-01). Nothing is
    // refused — an unknown type is simply a plain file, only ever downloaded.
    const storedMime = sniffMime(buffer) ?? "application/octet-stream";

    const ext = extFor(pick.mime, pick.name);
    const id = randomUUID();
    const fileName = `${id}.${ext}`;
    const key = `clinics/${clinic.id}/chat/${conversationId}/${fileName}`;
    const displayName = pick.name || fileName;
    const kind: InboundAttachment["kind"] = storedMime.startsWith("image/")
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
      await uploadObject(undefined, key, buffer, storedMime);
      const q = new URLSearchParams({ key, name: displayName });
      url = `/api/crm/conversations/${conversationId}/attachments/file?${q.toString()}`;
    }

    return [
      {
        kind,
        url,
        mimeType: storedMime,
        name: displayName,
        sizeBytes: pick.sizeBytes ?? buffer.byteLength,
        tgType: pick.tgType,
        ...(pick.durationSec !== undefined
          ? { durationSec: pick.durationSec }
          : {}),
      },
    ];
  } catch (e) {
    console.warn(
      `[tg:inbound-media] ingest failed conv=${conversationId}: ${(e as Error).message}`,
    );
    return [];
  }
}

const PREVIEW_BY_TYPE: Partial<Record<TgMediaType, string>> = {
  photo: "📷 Фото",
  voice: "🎤 Голосовое",
  video_note: "📹 Видеосообщение",
  video: "🎬 Видео",
  animation: "🎬 GIF",
};

/**
 * Short preview label for a conversation list / realtime event. Stored in
 * `Conversation.lastMessageText`, next to the «📷 Фото» the outbound route
 * writes. `msg` names the media even when its download failed, so a voice
 * note never leaves the inbox row blank.
 */
export function mediaPreviewLabel(
  attachments: InboundAttachment[],
  msg?: TgMediaMessage,
): string {
  const a = attachments[0];
  const type = a?.tgType ?? (msg ? inboundMediaType(msg) : null);
  if (type === "sticker") {
    const emoji =
      msg?.sticker && typeof msg.sticker === "object"
        ? (msg.sticker as TgSticker).emoji
        : undefined;
    return emoji ? `${emoji} Стикер` : "Стикер";
  }
  if (type === "audio") return a?.name ? `🎵 ${a.name}` : "🎵 Аудио";
  if (type && PREVIEW_BY_TYPE[type]) return PREVIEW_BY_TYPE[type]!;
  if (!a) return type ? "📎 Файл" : "";
  if (a.kind === "image") return "📷 Фото";
  if (a.mimeType?.startsWith("video/")) return "🎬 Видео";
  if (a.mimeType?.startsWith("audio/")) return "🎵 Аудио";
  return a.name ? `📎 ${a.name}` : "📎 Файл";
}

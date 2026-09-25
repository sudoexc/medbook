import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-01: a patient's voice note («после вашего препарата кружится
 * голова»), round video, audio, sticker or shared location reached the CRM as
 * an empty «Без текста» bubble: `pickMedia` only knew photo / document /
 * video / animation, the file was never fetched, and Telegram's link expires
 * within the hour. Now they are fetched, typed by their bytes (sniffMime) and
 * stored like any chat attachment; a location becomes text with a map link.
 */

const state = vi.hoisted(() => ({
  files: {} as Record<string, Uint8Array<ArrayBuffer>>,
  getFileCalls: [] as string[],
  uploads: [] as Array<{ key: string; type: string }>,
}));

vi.mock("@/server/telegram/bot-api", () => ({
  getFile: vi.fn(async (_token: string, fileId: string) => {
    state.getFileCalls.push(fileId);
    return { ok: true, result: { file_id: fileId, file_path: `files/${fileId}` } };
  }),
  buildFileDownloadUrl: (_token: string, filePath: string) =>
    `https://tg.test/${filePath}`,
}));

vi.mock("@/server/storage/minio", () => ({
  isStubMode: () => false,
  uploadObject: vi.fn(
    async (_bucket: unknown, key: string, _buf: Buffer, type: string) => {
      state.uploads.push({ key, type });
    },
  ),
}));

import {
  inboundLocationText,
  inboundMediaType,
  ingestTelegramMedia,
  mediaPreviewLabel,
} from "@/server/telegram/inbound-media";

const bytes = (...parts: (number[] | string)[]): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );

// What Telegram actually serves for each kind.
const OGG_OPUS = bytes("OggS", [0, 2, 0, 0, 0, 0, 0, 0, 0, 0], "OpusHead");
const MP4 = bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0]);
const MP3 = bytes("ID3", [4, 0, 0, 0, 0, 0, 0]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const TGS = bytes([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0]); // gzipped Lottie

const clinic = {
  id: "clinic_A",
  slug: "alpha",
  tgBotToken: "TOKEN",
  tgBotUsername: "alpha_bot",
};

beforeEach(() => {
  state.files = {};
  state.getFileCalls = [];
  state.uploads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const id = url.split("/").pop()!;
      const body = state.files[id];
      return body
        ? new Response(new Uint8Array(body), { status: 200 })
        : new Response("", { status: 404 });
    }),
  );
});

describe("ingestTelegramMedia — voice, video notes, audio, stickers", () => {
  it("keeps a patient's voice note as a playable audio/ogg file", async () => {
    state.files.voice_1 = OGG_OPUS;
    const out = await ingestTelegramMedia(clinic, "conv_1", {
      voice: { file_id: "voice_1", duration: 7, mime_type: "audio/ogg", file_size: 18 },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "file",
      mimeType: "audio/ogg",
      tgType: "voice",
      durationSec: 7,
    });
    expect(out[0]!.url).toMatch(
      /^\/api\/crm\/conversations\/conv_1\/attachments\/file\?key=clinics%2Fclinic_A%2Fchat%2Fconv_1%2F.+\.ogg/,
    );
    expect(state.uploads[0]!.type).toBe("audio/ogg");
  });

  it("stores a round video note as video/mp4", async () => {
    state.files.note_1 = MP4;
    const [a] = await ingestTelegramMedia(clinic, "conv_1", {
      video_note: { file_id: "note_1", length: 240, duration: 12 },
    });
    expect(a).toMatchObject({ kind: "file", mimeType: "video/mp4", tgType: "video_note" });
  });

  it("stores an audio file with its own name", async () => {
    state.files.aud_1 = MP3;
    const [a] = await ingestTelegramMedia(clinic, "conv_1", {
      audio: { file_id: "aud_1", duration: 95, file_name: "record.mp3" },
    });
    expect(a).toMatchObject({
      kind: "file",
      mimeType: "audio/mpeg",
      tgType: "audio",
      name: "record.mp3",
    });
  });

  it("shows a static sticker as an image, and an animated one by its still thumbnail", async () => {
    state.files.st_1 = WEBP;
    state.files.thumb_1 = WEBP;
    const [still] = await ingestTelegramMedia(clinic, "conv_1", {
      sticker: { file_id: "st_1", emoji: "👍" },
    });
    expect(still).toMatchObject({ kind: "image", mimeType: "image/webp", tgType: "sticker" });

    state.getFileCalls = [];
    const [animated] = await ingestTelegramMedia(clinic, "conv_1", {
      sticker: {
        file_id: "anim_1",
        is_animated: true,
        emoji: "😀",
        thumbnail: { file_id: "thumb_1" },
      },
    });
    expect(state.getFileCalls).toEqual(["thumb_1"]);
    expect(animated).toMatchObject({ kind: "image", tgType: "sticker" });
  });

  it("keeps an animated sticker without a thumbnail as a plain download", async () => {
    state.files.anim_2 = TGS;
    const [a] = await ingestTelegramMedia(clinic, "conv_1", {
      sticker: { file_id: "anim_2", is_animated: true },
    });
    expect(a).toMatchObject({ kind: "file", mimeType: "application/octet-stream" });
  });

  it("does not try to fetch a file above the Bot API's 20 MB limit", async () => {
    const out = await ingestTelegramMedia(clinic, "conv_1", {
      audio: { file_id: "big", duration: 3600, file_size: 25 * 1024 * 1024 },
    });
    expect(out).toEqual([]);
    expect(state.getFileCalls).toEqual([]);
  });
});

describe("mediaPreviewLabel", () => {
  it("names a voice note in the inbox row, even when its download failed", async () => {
    const msg = { voice: { file_id: "gone", duration: 4 } };
    expect(inboundMediaType(msg)).toBe("voice");
    expect(mediaPreviewLabel([], msg)).toBe("🎤 Голосовое");
    const out = await ingestTelegramMedia(clinic, "conv_1", msg); // 404
    expect(out).toEqual([]);
    expect(mediaPreviewLabel(out, msg)).not.toBe("");
  });

  it("labels video notes, stickers and audio", () => {
    expect(mediaPreviewLabel([], { video_note: { file_id: "x" } })).toBe(
      "📹 Видеосообщение",
    );
    expect(mediaPreviewLabel([], { sticker: { file_id: "x", emoji: "👍" } })).toBe(
      "👍 Стикер",
    );
    expect(
      mediaPreviewLabel(
        [{ kind: "file", url: "/u", name: "record.mp3", tgType: "audio" }],
        { audio: { file_id: "x" } },
      ),
    ).toBe("🎵 record.mp3");
  });
});

describe("inboundLocationText", () => {
  it("turns a shared location into coordinates and a map link", () => {
    const text = inboundLocationText({
      location: { latitude: 41.311081, longitude: 69.240562 },
    });
    expect(text).toBe(
      "📍 41.311081, 69.240562\nhttps://maps.google.com/?q=41.311081,69.240562",
    );
  });

  it("names a venue before its coordinates", () => {
    const text = inboundLocationText({
      venue: {
        location: { latitude: 41.3, longitude: 69.2 },
        title: "NeuroFax",
        address: "Чиланзар, 5",
      },
    });
    expect(text?.split("\n")).toEqual([
      "📍 NeuroFax, Чиланзар, 5",
      "41.300000, 69.200000",
      "https://maps.google.com/?q=41.300000,69.200000",
    ]);
  });

  it("is null for a message without a location", () => {
    expect(inboundLocationText({})).toBeNull();
  });
});

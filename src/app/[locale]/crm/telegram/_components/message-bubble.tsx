"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CheckIcon,
  CheckCheckIcon,
  ClockIcon,
  AlertCircleIcon,
  BotIcon,
  HeadsetIcon,
  DownloadIcon,
  MicIcon,
  MusicIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/chat-attachments";
import { DateText } from "@/components/atoms/date-text";

import type { InboxMessage } from "../_hooks/types";
import { failedReasonText } from "../_lib/failed-reason";
import { FileTypeIcon } from "./file-icon";

/**
 * Simple markdown-lite renderer: `**bold**`, `*italic*`, auto-link http(s)
 * URLs, and preserve line breaks. Good enough for operator-written messages
 * and bot replies; anything richer (tables, images) lives in `attachments`.
 *
 * Escapes HTML first so rendered content never executes.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mdLite(body: string): string {
  let out = escapeHtml(body);
  // Bold **x**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic *x* (lazy; no nesting)
  out = out.replace(/(^|\s)\*([^*\n]+)\*(\s|$)/g, "$1<em>$2</em>$3");
  // Linkify http/https URLs
  out = out.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline">$1</a>',
  );
  // Newlines → <br>
  out = out.replace(/\n/g, "<br />");
  return out;
}

type ImageAttachment = {
  kind: "image";
  url: string;
  mimeType?: string;
  name?: string;
  width?: number;
  height?: number;
  /** Set on media a patient sent through the bot (see inbound-media.ts). */
  tgType?: string;
};

function isImageAttachment(x: unknown): x is ImageAttachment {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return (
    obj.kind === "image" &&
    typeof obj.url === "string" &&
    obj.url.length > 0
  );
}

type FileAttachment = {
  kind: "file";
  url: string;
  mimeType?: string;
  name?: string;
  sizeBytes?: number;
  tgType?: string;
  durationSec?: number;
};

/**
 * Voice notes, audio and video are stored as files typed by their bytes
 * (`audio/ogg`, `video/mp4`, …) and served inline by the attachment proxy, so
 * they play right in the bubble instead of being a download (audit TG-01).
 */
function isAudio(f: FileAttachment): boolean {
  return (f.mimeType ?? "").startsWith("audio/");
}
function isVideo(f: FileAttachment): boolean {
  return (f.mimeType ?? "").startsWith("video/");
}

/** 75 → "1:15". */
function formatDuration(sec: number | undefined): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function isFileAttachment(x: unknown): x is FileAttachment {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return (
    obj.kind === "file" &&
    typeof obj.url === "string" &&
    obj.url.length > 0
  );
}

export interface MessageBubbleProps {
  message: InboxMessage;
  /** First message of a consecutive same-author run — gets extra top spacing. */
  groupStart?: boolean;
  /** Last message of the run — gets the tail corner + avatar. */
  groupEnd?: boolean;
}

export function MessageBubble({
  message,
  groupStart = true,
  groupEnd = true,
}: MessageBubbleProps) {
  const t = useTranslations("tgInbox");
  const isOut = message.direction === "OUT";
  const body = message.body ?? "";
  const html = mdLite(body);

  // Render inline buttons if the message carries them (Telegram
  // inline_keyboard-shaped array of arrays).
  const buttons = Array.isArray(message.buttons)
    ? (message.buttons as Array<
        Array<{ text: string; callback_data?: string; url?: string }>
      >)
    : null;

  const images = Array.isArray(message.attachments)
    ? (message.attachments as unknown[]).filter(isImageAttachment)
    : [];
  const allFiles = Array.isArray(message.attachments)
    ? (message.attachments as unknown[]).filter(isFileAttachment)
    : [];
  const audios = allFiles.filter(isAudio);
  const videos = allFiles.filter(isVideo);
  const files = allFiles.filter((f) => !isAudio(f) && !isVideo(f));

  const isBotReply = isOut && !message.senderId;
  const onRight = isOut;

  return (
    <div
      data-message-id={message.id}
      data-message-body={body}
      className={cn(
        "flex items-end gap-1.5 rounded-md transition-shadow",
        groupStart ? "mt-3" : "mt-0.5",
        onRight ? "flex-row-reverse" : "",
      )}
    >
      {isOut ? (
        groupEnd ? (
          <span
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-border/50",
              isBotReply
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {isBotReply ? (
              <BotIcon className="size-3.5" />
            ) : (
              <HeadsetIcon className="size-3.5" />
            )}
          </span>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )
      ) : null}
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm ring-1",
          onRight
            ? cn(
                isBotReply
                  ? "bg-muted/70 text-foreground ring-border/50"
                  : "bg-primary/10 text-foreground ring-primary/10",
                groupEnd && "rounded-br-md",
              )
            : cn("bg-card text-foreground ring-border/60", groupEnd && "rounded-bl-md"),
        )}
      >
        {isOut && groupStart ? (
          <div
            className={cn(
              "mb-1 text-[11px] font-semibold leading-none",
              isBotReply ? "text-primary" : "text-foreground/70",
            )}
          >
            {isBotReply ? t("mode.bot") : message.sender?.name ?? t("mode.operator")}
          </div>
        ) : null}
        {images.length > 0 ? (
          <div
            className={cn(
              "mb-1 grid gap-1 overflow-hidden rounded-lg",
              images.length === 1 ? "grid-cols-1" : "grid-cols-2",
            )}
          >
            {images.map((img, i) => (
              <a
                key={i}
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name ?? ""}
                  className={
                    img.tgType === "sticker"
                      ? "block size-32 object-contain"
                      : "block max-h-72 w-full rounded-md object-cover"
                  }
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        ) : null}
        {videos.length > 0 ? (
          <div className="mb-1 space-y-1">
            {videos.map((v, i) => (
              <div key={i}>
                {v.tgType === "video_note" ? (
                  <div className="mb-0.5 text-[11px] text-muted-foreground">
                    {t("message.videoNote")}
                    {formatDuration(v.durationSec)
                      ? ` · ${formatDuration(v.durationSec)}`
                      : null}
                  </div>
                ) : null}
                <video
                  src={v.url}
                  controls
                  playsInline
                  preload="metadata"
                  className={
                    v.tgType === "video_note"
                      ? "block size-48 rounded-full bg-muted object-cover"
                      : "block max-h-72 w-full rounded-md bg-muted"
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
        {audios.length > 0 ? (
          <div className="mb-1 space-y-1">
            {audios.map((a, i) => {
              const voice = a.tgType === "voice";
              const length = formatDuration(a.durationSec);
              return (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-card/60 px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                    {voice ? (
                      <MicIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <MusicIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate">
                      {voice ? t("message.voice") : (a.name ?? t("message.audio"))}
                    </span>
                    {length ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {length}
                      </span>
                    ) : null}
                    <a
                      href={a.url}
                      download={a.name ?? true}
                      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("message.download")}
                      title={t("message.download")}
                    >
                      <DownloadIcon className="size-3.5" />
                    </a>
                  </div>
                  <audio
                    src={a.url}
                    controls
                    preload="metadata"
                    className="block h-9 w-64 max-w-full"
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="mb-1 space-y-1">
            {files.map((f, i) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                download={f.name ?? true}
                className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2 transition-colors hover:bg-card"
              >
                <FileTypeIcon
                  nameOrExt={f.name ?? f.mimeType ?? ""}
                  className="size-7 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {f.name ?? t("message.file")}
                  </span>
                  {typeof f.sizeBytes === "number" ? (
                    <span className="block text-[11px] text-muted-foreground">
                      {formatBytes(f.sizeBytes)}
                    </span>
                  ) : null}
                </span>
                <DownloadIcon className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        ) : null}
        {body ? (
          <div
            className="whitespace-pre-wrap break-words"
            // Safe: escaped + limited tags.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : images.length === 0 && allFiles.length === 0 ? (
          <div className="italic opacity-70">{t("message.noText")}</div>
        ) : null}
        {buttons && buttons.length > 0 ? (
          <div className="mt-2 space-y-1">
            {buttons.map((row, ri) => (
              <div key={ri} className="flex flex-wrap gap-1">
                {row.map((b, bi) => (
                  <span
                    key={bi}
                    className="inline-flex items-center rounded-full border border-primary/30 bg-card px-2 py-0.5 text-xs text-primary"
                  >
                    {b.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-[11px] text-muted-foreground",
            onRight ? "justify-end" : "justify-start",
          )}
        >
          <DateText date={message.createdAt} style="time" />
          {isOut ? <DeliveryIcon status={message.status} /> : null}
        </div>
        {isOut && message.status === "FAILED" ? (
          <div className="mt-0.5 text-right text-[11px] font-medium text-destructive">
            {t("message.failed.title")}: {failedReasonText(t, message.failedReason)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeliveryIcon({ status }: { status: InboxMessage["status"] }) {
  switch (status) {
    case "QUEUED":
      return <ClockIcon className="size-3" />;
    case "SENT":
      return <CheckIcon className="size-3" />;
    case "DELIVERED":
      return <CheckCheckIcon className="size-3" />;
    case "READ":
      return <CheckCheckIcon className="size-3 text-info" />;
    case "FAILED":
      return <AlertCircleIcon className="size-3 text-destructive" />;
    default:
      return null;
  }
}

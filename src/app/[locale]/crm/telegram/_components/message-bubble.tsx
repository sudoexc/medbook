"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CheckCheckIcon, ClockIcon, AlertCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DateText } from "@/components/atoms/date-text";

import type { InboxMessage } from "../_hooks/types";

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

export interface MessageBubbleProps {
  message: InboxMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
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

  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[68%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          isOut
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
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
                  className="block max-h-72 w-full rounded-md object-cover"
                  loading="lazy"
                />
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
        ) : images.length === 0 ? (
          <div className="italic opacity-70">{t("message.noText")}</div>
        ) : null}
        {buttons && buttons.length > 0 ? (
          <div className="mt-2 space-y-1">
            {buttons.map((row, ri) => (
              <div key={ri} className="flex flex-wrap gap-1">
                {row.map((b, bi) => (
                  <span
                    key={bi}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
                      isOut
                        ? "border-primary-foreground/30 text-primary-foreground"
                        : "border-border text-foreground",
                    )}
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
            "mt-1 flex items-center gap-1 text-[11px]",
            isOut ? "justify-end text-primary-foreground/75" : "justify-start text-muted-foreground",
          )}
        >
          <DateText date={message.createdAt} style="time" />
          {isOut ? <DeliveryIcon status={message.status} /> : null}
        </div>
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

"use client";

import * as React from "react";

/**
 * Lightweight cross-component event bus for the Telegram inbox. Used to
 * wire actions from the right rail into the chat pane and composer without
 * threading callbacks through the page-client root.
 *
 * Events are scoped by `conversationId` so a stale listener from a previously
 * selected chat never fires.
 */

type ComposerInsertDetail = {
  conversationId: string;
  text: string;
  mode?: "append" | "replace";
};

type ChatFindDetail = {
  conversationId: string;
  term: string;
};

const COMPOSER_INSERT = "tg:composer-insert";
const CHAT_FIND = "tg:chat-find";

export function dispatchComposerInsert(detail: ComposerInsertDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ComposerInsertDetail>(COMPOSER_INSERT, { detail }),
  );
}

export function dispatchChatFind(detail: ChatFindDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatFindDetail>(CHAT_FIND, { detail }),
  );
}

export function useComposerInsert(
  conversationId: string | null,
  cb: (detail: ComposerInsertDetail) => void,
): void {
  const cbRef = React.useRef(cb);
  cbRef.current = cb;
  React.useEffect(() => {
    if (!conversationId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ComposerInsertDetail>).detail;
      if (detail.conversationId !== conversationId) return;
      cbRef.current(detail);
    };
    window.addEventListener(COMPOSER_INSERT, handler);
    return () => window.removeEventListener(COMPOSER_INSERT, handler);
  }, [conversationId]);
}

export function useChatFind(
  conversationId: string | null,
  cb: (detail: ChatFindDetail) => void,
): void {
  const cbRef = React.useRef(cb);
  cbRef.current = cb;
  React.useEffect(() => {
    if (!conversationId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ChatFindDetail>).detail;
      if (detail.conversationId !== conversationId) return;
      cbRef.current(detail);
    };
    window.addEventListener(CHAT_FIND, handler);
    return () => window.removeEventListener(CHAT_FIND, handler);
  }, [conversationId]);
}

"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type MessageDirection = "IN" | "OUT";
export type MessageStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export type MessageAttachment = {
  kind: "image" | "file" | "audio" | "video";
  url: string;
  name?: string;
  size?: number;
  mime?: string;
};

export type MessageRow = {
  id: string;
  clinicId: string;
  conversationId: string;
  direction: MessageDirection;
  body: string | null;
  attachments: MessageAttachment[] | null;
  buttons: unknown[] | null;
  senderId: string | null;
  status: MessageStatus;
  externalId: string | null;
  replyToId: string | null;
  createdAt: string;
  sender: { id: string; name: string } | null;
};

export type MessagesResponse = {
  rows: MessageRow[];
  nextCursor: string | null;
};

export function conversationMessagesKey(conversationId: string) {
  return ["doctor", "me", "conversation", conversationId, "messages"] as const;
}

export function useConversationMessages(
  conversationId: string | null,
  limit = 50,
) {
  return useInfiniteQuery<
    MessagesResponse,
    Error,
    { pages: MessagesResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof conversationMessagesKey>,
    string | undefined
  >({
    queryKey: conversationMessagesKey(conversationId ?? "__none__"),
    enabled: !!conversationId,
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (!conversationId) {
        return { rows: [], nextCursor: null } as MessagesResponse;
      }
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (pageParam) params.set("cursor", pageParam);
      const res = await fetch(
        `/api/crm/conversations/${conversationId}/messages?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`Failed to load messages: ${res.status}`);
      }
      return (await res.json()) as MessagesResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Flatten and sort messages by ascending time (oldest first, newest last).
 * The API returns newest-first cursor-paginated; for chat display we want the
 * conventional bottom-anchored layout.
 */
export function flattenMessagesAsc(
  data: { pages: MessagesResponse[] } | undefined,
): MessageRow[] {
  if (!data) return [];
  const out: MessageRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  // Sort by createdAt ascending. Stable sort keeps insertion order on ties.
  return out.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

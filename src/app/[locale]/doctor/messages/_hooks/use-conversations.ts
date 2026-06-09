"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type ConversationChannel = "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT";
export type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";

export type ConversationRow = {
  id: string;
  clinicId: string;
  channel: ConversationChannel;
  mode: "bot" | "takeover";
  patientId: string | null;
  appointmentId: string | null;
  externalId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactUsername: string | null;
  status: ConversationStatus;
  assignedToId: string | null;
  tags: string[];
  lastMessageAt: string | null;
  lastMessageText: string | null;
  unreadCount: number;
  snoozedUntil: string | null;
  createdAt: string;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
  } | null;
  assignedTo: { id: string; name: string } | null;
};

export type ConversationsResponse = {
  rows: ConversationRow[];
  nextCursor: string | null;
};

export type ConversationsFilters = {
  q?: string;
  channel?: ConversationChannel;
  unread?: boolean;
};

function buildSearch(
  filters: ConversationsFilters,
  cursor?: string,
  limit = 50,
): string {
  const params = new URLSearchParams();
  params.set("doctorId", "me");
  if (filters.q) params.set("q", filters.q);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.unread) params.set("unread", "true");
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function doctorConversationsKey(filters: ConversationsFilters) {
  return ["doctor", "me", "conversations", filters] as const;
}

export function useDoctorConversations(
  filters: ConversationsFilters,
  limit = 50,
) {
  return useInfiniteQuery<
    ConversationsResponse,
    Error,
    { pages: ConversationsResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof doctorConversationsKey>,
    string | undefined
  >({
    queryKey: doctorConversationsKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/conversations?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load conversations: ${res.status}`);
      }
      return (await res.json()) as ConversationsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenConversations(
  data: { pages: ConversationsResponse[] } | undefined,
): ConversationRow[] {
  if (!data) return [];
  const out: ConversationRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}

// `t` is threaded in (not read via useTranslations) so these stay plain
// functions usable outside React — the only localized output is the
// no-name fallback (doctor.messages.threads.noName).
type Translate = (key: string) => string;

export function conversationTitle(c: ConversationRow, t: Translate): string {
  if (c.patient) return c.patient.fullName;
  const first = c.contactFirstName?.trim() || "";
  const last = c.contactLastName?.trim() || "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (c.contactUsername) return `@${c.contactUsername}`;
  if (c.externalId) return c.externalId;
  return t("threads.noName");
}

export function conversationInitials(c: ConversationRow, t: Translate): string {
  const title = conversationTitle(c, t);
  const parts = title.replace("@", "").trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";
}

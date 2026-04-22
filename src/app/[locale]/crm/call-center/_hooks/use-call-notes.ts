"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { CallRow } from "./types";

/**
 * Debounced PATCH /api/crm/calls/[id] for the notes/summary field.
 *
 * Usage:
 *   const { value, setValue, flush, isSaving } = useCallNotes(call);
 *   <Textarea value={value} onChange={(e) => setValue(e.target.value)} onBlur={flush} />
 *
 * The hook keeps a local buffer so typing feels instant, then PATCHes after
 * 800ms of inactivity or on explicit `flush()` (e.g. textarea blur).
 */
const DEBOUNCE_MS = 800;

export function useCallNotes(call: CallRow | null) {
  const qc = useQueryClient();
  const [value, setValue] = React.useState<string>(call?.summary ?? "");
  const lastSentRef = React.useRef<string>(call?.summary ?? "");
  const timerRef = React.useRef<number | null>(null);

  // Reset buffer when the active call changes.
  React.useEffect(() => {
    setValue(call?.summary ?? "");
    lastSentRef.current = call?.summary ?? "";
  }, [call?.id, call?.summary]);

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      if (!call) return null;
      const res = await fetch(`/api/crm/calls/${call.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: next || null }),
      });
      if (!res.ok) throw new Error(`PATCH call notes failed: ${res.status}`);
      return (await res.json()) as CallRow;
    },
    onSuccess: (row) => {
      if (!row) return;
      lastSentRef.current = row.summary ?? "";
      qc.setQueryData(
        ["call-center", "active", row.id],
        (prev: CallRow | null | undefined) => (prev ? { ...prev, summary: row.summary } : row),
      );
      qc.invalidateQueries({ queryKey: ["call-center", "history"] });
    },
  });

  const scheduleFlush = React.useCallback(
    (next: string) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        if (next !== lastSentRef.current) mutation.mutate(next);
      }, DEBOUNCE_MS);
    },
    [mutation],
  );

  const setValueDebounced = React.useCallback(
    (next: string) => {
      setValue(next);
      scheduleFlush(next);
    },
    [scheduleFlush],
  );

  const flush = React.useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (value !== lastSentRef.current) mutation.mutate(value);
  }, [mutation, value]);

  React.useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    value,
    setValue: setValueDebounced,
    flush,
    isSaving: mutation.isPending,
  };
}

/**
 * PATCH /api/crm/calls/[id] for fields other than the notes buffer (status
 * shortcuts like "mark missed", operator assignment, etc.).
 */
export function useCallPatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`/api/crm/calls/${args.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.patch),
      });
      if (!res.ok) throw new Error(`PATCH call failed: ${res.status}`);
      return (await res.json()) as CallRow;
    },
    onSuccess: (row) => {
      qc.setQueryData(["call-center", "active", row.id], row);
      qc.invalidateQueries({ queryKey: ["call-center", "history"] });
      qc.invalidateQueries({ queryKey: ["call-center", "incoming"] });
    },
  });
}

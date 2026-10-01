"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { shellSummaryKey } from "@/hooks/use-shell-summary";
import {
  hasUnsavedNotes,
  initialNotesBuffer,
  notesSaved,
  reconcileNotesBuffer,
  type NotesBuffer,
} from "@/lib/calls/notes-buffer";

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
 *
 * Audit CM-06: the server copy never overwrites text that is not saved yet
 * (`reconcileNotesBuffer`), every save names the call it belongs to (a
 * pending save used to fire after the operator had switched calls and wrote
 * the old call's text onto the new one), and saves run one after another so
 * an older one cannot land last.
 */
const DEBOUNCE_MS = 800;

type SaveVars = { id: string; summary: string };

export function useCallNotes(call: CallRow | null) {
  const qc = useQueryClient();
  const callId = call?.id ?? null;
  const serverSummary = call?.summary ?? "";
  const [buf, setBuf] = React.useState<NotesBuffer>(() =>
    initialNotesBuffer(callId, serverSummary),
  );
  const timerRef = React.useRef<number | null>(null);
  /** The edit waiting for the debounce, bound to its call. */
  const pendingRef = React.useRef<SaveVars | null>(null);

  const mutation = useMutation({
    // One queue for every notes save of this screen: an older save can
    // never overwrite a newer one.
    scope: { id: "call-center-notes" },
    mutationFn: async (vars: SaveVars) => {
      const res = await fetch(`/api/crm/calls/${vars.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: vars.summary || null }),
      });
      if (!res.ok) throw new Error(`PATCH call notes failed: ${res.status}`);
      return (await res.json()) as CallRow;
    },
    onSuccess: (row, vars) => {
      setBuf((b) => notesSaved(b, vars.id, vars.summary));
      qc.setQueryData(
        ["call-center", "active", row.id],
        (prev: CallRow | null | undefined) => (prev ? { ...prev, summary: row.summary } : row),
      );
      void qc.invalidateQueries({ queryKey: ["call-center", "missed"] });
    },
  });
  // `mutate` is stable across renders (TanStack binds it to the observer).
  const { mutate } = mutation;

  const sendPending = React.useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) mutate(pending);
  }, [mutate]);

  // Another call, or a newer server copy: reconcile without losing typing.
  // A save still waiting for the debounce goes out first, to ITS call.
  React.useEffect(() => {
    if (pendingRef.current && pendingRef.current.id !== callId) sendPending();
    setBuf((b) => reconcileNotesBuffer(b, callId, serverSummary));
  }, [callId, serverSummary, sendPending]);

  const setValue = React.useCallback(
    (next: string) => {
      setBuf((b) => ({ ...b, value: next }));
      if (!callId) return;
      pendingRef.current = { id: callId, summary: next };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(sendPending, DEBOUNCE_MS);
    },
    [callId, sendPending],
  );

  const flush = React.useCallback(() => {
    if (pendingRef.current) {
      sendPending();
      return;
    }
    // A save that failed earlier left the text unsaved: try again.
    if (callId && hasUnsavedNotes(buf)) {
      mutate({ id: callId, summary: buf.value });
    }
  }, [buf, callId, mutate, sendPending]);

  // Leaving the page with an edit still waiting for the debounce saves it.
  React.useEffect(() => () => sendPending(), [sendPending]);

  return {
    value: buf.value,
    setValue,
    flush,
    isSaving: mutation.isPending,
  };
}

/**
 * «Завершить» / «Пропуск»: POST /api/crm/calls/[id]/end (audit CM-07). The
 * server writes the status, direction and duration and tells every operator;
 * here the queues, the missed list and the badges refetch.
 */
export function useEndCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; outcome: "ENDED" | "MISSED" }) => {
      const res = await fetch(`/api/crm/calls/${args.id}/end`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: args.outcome }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          reason?: string;
        } | null;
        throw new EndCallError(res.status, body?.reason ?? null);
      }
      return (await res.json()) as CallRow;
    },
    onSuccess: (row) => {
      qc.setQueryData(["call-center", "active", row.id], row);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["call-center"] });
      void qc.invalidateQueries({ queryKey: ["reception", "calls"] });
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
    },
  });
}

export class EndCallError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(reason ?? `HTTP ${status}`);
    this.name = "EndCallError";
  }
}

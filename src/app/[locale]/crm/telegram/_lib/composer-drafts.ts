/**
 * Composer drafts, one per conversation (audit G6-01).
 *
 * The composer kept its text, inline buttons and attachments in component
 * state, and the chat pane reused the same component when the operator
 * opened another dialog. A PDF with patient A's MRI and a half-typed reply
 * stayed in the box and went to patient B on Enter.
 *
 * Every draft now lives under its conversation id. Switching dialogs shows
 * that dialog's own draft (empty for a new one) and brings A's back when the
 * operator returns. An upload that finishes after a switch lands in the
 * draft of the dialog it was attached in, never in the one on screen.
 */
export type InlineBtn = { text: string; callback_data?: string; url?: string };

export type ComposerDraft<A> = {
  text: string;
  buttonRows: InlineBtn[][];
  attachments: A[];
};

export type DraftStore<A> = {
  get(conversationId: string): ComposerDraft<A>;
  update(
    conversationId: string,
    fn: (draft: ComposerDraft<A>) => ComposerDraft<A>,
  ): void;
  clear(conversationId: string): void;
  subscribe(listener: () => void): () => void;
};

export function createDraftStore<A>(): DraftStore<A> {
  // One frozen empty draft, so `get` is referentially stable for
  // useSyncExternalStore while nothing is typed.
  const empty: ComposerDraft<A> = Object.freeze({
    text: "",
    buttonRows: [],
    attachments: [],
  }) as ComposerDraft<A>;
  const drafts = new Map<string, ComposerDraft<A>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    get: (id) => drafts.get(id) ?? empty,
    update(id, fn) {
      const next = fn(drafts.get(id) ?? empty);
      const blank =
        next.text === "" &&
        next.buttonRows.length === 0 &&
        next.attachments.length === 0;
      if (blank) drafts.delete(id);
      else drafts.set(id, next);
      notify();
    },
    clear(id) {
      if (drafts.delete(id)) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

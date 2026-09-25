import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDraftStore } from "@/app/[locale]/crm/telegram/_lib/composer-drafts";

/**
 * Audit G6-01: the composer's text, inline buttons and attachments were
 * component state, and the chat pane reused the component for the next
 * dialog. Patient A's MRI PDF and a half-typed reply stayed in the box and
 * went to patient B on Enter. Drafts now live per conversation.
 */

type Att = { id: string; status: "uploading" | "ready"; url?: string };

describe("composer drafts are per conversation", () => {
  it("text and a file typed in chat A are not in chat B's composer", () => {
    const drafts = createDraftStore<Att>();
    drafts.update("A", (d) => ({
      ...d,
      text: "Результаты МРТ во вложении",
      attachments: [{ id: "f1", status: "ready", url: "/api/crm/conversations/A/…" }],
      buttonRows: [[{ text: "Записаться", callback_data: "book" }]],
    }));

    // The operator opens chat B.
    const b = drafts.get("B");
    expect(b.text).toBe("");
    expect(b.attachments).toEqual([]);
    expect(b.buttonRows).toEqual([]);

    // And finds A's draft intact when she comes back.
    expect(drafts.get("A").text).toBe("Результаты МРТ во вложении");
    expect(drafts.get("A").attachments).toHaveLength(1);
  });

  it("an upload finishing after the switch lands in A's draft, never in B's", () => {
    const drafts = createDraftStore<Att>();
    drafts.update("A", (d) => ({ ...d, attachments: [{ id: "f1", status: "uploading" }] }));
    // Switched to B, then the upload for A completes.
    drafts.update("A", (d) => ({
      ...d,
      attachments: d.attachments.map((a) =>
        a.id === "f1" ? { ...a, status: "ready" as const, url: "/a.pdf" } : a,
      ),
    }));
    expect(drafts.get("A").attachments[0]).toMatchObject({ status: "ready" });
    expect(drafts.get("B").attachments).toEqual([]);
  });

  it("sending clears only that conversation's draft", () => {
    const drafts = createDraftStore<Att>();
    drafts.update("A", (d) => ({ ...d, text: "a" }));
    drafts.update("B", (d) => ({ ...d, text: "b" }));
    drafts.clear("A");
    expect(drafts.get("A").text).toBe("");
    expect(drafts.get("B").text).toBe("b");
  });

  it("is a stable external store: same snapshot until changed, listeners told on change", () => {
    const drafts = createDraftStore<Att>();
    expect(drafts.get("A")).toBe(drafts.get("A"));
    const listener = vi.fn();
    const off = drafts.subscribe(listener);
    drafts.update("A", (d) => ({ ...d, text: "x" }));
    expect(listener).toHaveBeenCalledTimes(1);
    const snap = drafts.get("A");
    expect(drafts.get("A")).toBe(snap);
    off();
    drafts.update("A", (d) => ({ ...d, text: "y" }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("chat workspace wiring", () => {
  const read = (rel: string) =>
    readFileSync(
      path.join(process.cwd(), "src/app/[locale]/crm/telegram/_components", rel),
      "utf8",
    );

  it("remounts the composer and the right-rail forms per dialog", () => {
    expect(read("chat-pane.tsx")).toMatch(
      /<MessageComposer key=\{conversation\.id\} conversation=\{conversation\} \/>/,
    );
    const rail = read("chat-right-rail.tsx");
    expect(rail).toMatch(/<CreatePatientForm key=\{conversation\.id\}/);
    expect(rail).toMatch(/<LinkedPatientRail key=\{conversation\.id\}/);
  });

  it("the composer reads its draft by conversation id and uploads into that conversation", () => {
    const composer = read("message-composer.tsx");
    expect(composer).toMatch(/useComposerDraft\(conversation\.id\)/);
    expect(composer).toMatch(/uploadOne\(conversation\.id, /);
    // No component-local draft state left behind.
    expect(composer).not.toMatch(/useState<LocalAttachment\[\]>/);
  });
});

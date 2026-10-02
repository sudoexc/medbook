/**
 * P6 lane B3, CM-21: a SUPER_ADMIN enters a clinic through a dialog with
 * «Только просмотр» preselected, and Cancel at any step sends nothing.
 *
 * The old window.prompt + window.confirm pair always had one button meaning
 * WRITE: first Cancel, then (after the first fix) the focused OK, so a
 * habitual second Enter allowed mutations. These tests pin the safe default,
 * the abort path and the localisation of the shared dialog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
}));

// The real AlertDialog portals into document.body, which a static render
// never reaches. Stand-ins keep the form's own markup and expose the
// open-state callback the dialog hands to Radix.
const alertDialog = vi.hoisted(() => ({
  onOpenChange: null as null | ((open: boolean) => void),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const pass = (tag: string, attrs: Record<string, string> = {}) =>
    function Pass({ children }: { children?: React.ReactNode }) {
      return React.createElement(tag, attrs, children);
    };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children?: React.ReactNode;
    }) => {
      alertDialog.onOpenChange = onOpenChange;
      return open ? React.createElement("div", { "data-dialog": "" }, children) : null;
    },
    AlertDialogContent: pass("div"),
    AlertDialogHeader: pass("header"),
    AlertDialogFooter: pass("footer"),
    AlertDialogTitle: pass("h2"),
    AlertDialogDescription: pass("p"),
    AlertDialogCancel: pass("button", { "data-cancel": "" }),
  };
});

import { ClinicEntryDialog } from "@/components/layout/clinic-entry-dialog";
import {
  CLINIC_ENTRY_DEFAULT_MODE,
  checkClinicEntry,
  parseClinicEntryMode,
  postClinicEntry,
} from "@/lib/clinic-entry";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

function render(target: { id: string; name: string } | null) {
  const onCancel = vi.fn();
  const onEnter = vi.fn(async () => {});
  const html = renderToStaticMarkup(
    React.createElement(ClinicEntryDialog, { target, onCancel, onEnter }),
  );
  return { html, onCancel, onEnter };
}

/** The <button role="radio"> Radix renders for one mode. */
function radio(html: string, value: string): string {
  const tag = html.match(new RegExp(`<button[^>]*value="${value}"[^>]*>`));
  expect(tag, value).not.toBeNull();
  return tag![0];
}

describe("CM-21: clinic entry rules", () => {
  it("defaults to read-only", () => {
    expect(CLINIC_ENTRY_DEFAULT_MODE).toBe("VIEW_ONLY");
  });

  it("only an exact WRITE writes; anything else reads as VIEW_ONLY", () => {
    expect(parseClinicEntryMode("WRITE")).toBe("WRITE");
    for (const v of ["VIEW_ONLY", "", "write", " WRITE", "anything"]) {
      expect(parseClinicEntryMode(v), v).toBe("VIEW_ONLY");
    }
  });

  it("trims the reason and refuses one shorter than 4 characters", () => {
    expect(checkClinicEntry("  проверка жалобы ", "VIEW_ONLY")).toEqual({
      ok: true,
      reason: "проверка жалобы",
      mode: "VIEW_ONLY",
    });
    expect(checkClinicEntry(" ab ", "WRITE")).toEqual({
      ok: false,
      error: "reason_too_short",
    });
  });

  it("sends the picked mode explicitly, never relying on the route default", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    await postClinicEntry(
      "c1",
      { reason: "fix booking", mode: "VIEW_ONLY" },
      fetchMock as unknown as typeof fetch,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/platform/session/switch-clinic");
    expect(JSON.parse(String(init.body))).toEqual({
      clinicId: "c1",
      reason: "fix booking",
      mode: "VIEW_ONLY",
    });
  });

  it("throws on a refused request so the dialog can show it", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(
      postClinicEntry(
        "c1",
        { reason: "fix booking", mode: "WRITE" },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow("HTTP 403");
  });
});

describe("CM-21: the entry dialog", () => {
  afterEach(() => {
    alertDialog.onOpenChange = null;
  });

  it("opens with «Только просмотр» preselected and WRITE unpicked", () => {
    const { html } = render({ id: "c1", name: "NeuroFax" });
    expect(radio(html, "VIEW_ONLY")).toContain('aria-checked="true"');
    expect(radio(html, "WRITE")).toContain('aria-checked="false"');
    // Read-only is listed first, so it is also the first stop for the keyboard.
    expect(html.indexOf('value="VIEW_ONLY"')).toBeLessThan(html.indexOf('value="WRITE"'));
  });

  it("names the clinic and has a Cancel next to the submit button", () => {
    const { html } = render({ id: "c1", name: "NeuroFax" });
    expect(html).toContain("adminPlatform.switcher.entry.title{&quot;clinic&quot;:&quot;NeuroFax&quot;}");
    expect(html).toMatch(/<button data-cancel="">adminPlatform\.switcher\.entry\.cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>adminPlatform\.switcher\.entry\.enter</);
  });

  it("Cancel or Esc (Radix closing the dialog) sends nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { onCancel, onEnter } = render({ id: "c1", name: "NeuroFax" });
      alertDialog.onOpenChange?.(false);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onEnter).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders nothing without a target", () => {
    expect(render(null).html).toBe("");
  });

  it("every string it shows exists in ru and uz", () => {
    const keys = [
      ...src("src/components/layout/clinic-entry-dialog.tsx").matchAll(/\bt\("([a-zA-Z]+)"/g),
    ].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const messages of [ru, uz]) {
      const entry = messages.adminPlatform.switcher.entry as Record<string, string>;
      for (const key of keys) expect(entry[key], key).toBeTruthy();
    }
    expect(Object.keys(uz.adminPlatform.switcher.entry)).toEqual(
      Object.keys(ru.adminPlatform.switcher.entry),
    );
  });
});

describe("CM-21: both entry points", () => {
  it("use the shared dialog instead of browser prompts", () => {
    for (const file of [
      "src/components/layout/clinic-switcher.tsx",
      "src/app/admin/clinics/_components/clinics-page-client.tsx",
    ]) {
      const s = src(file);
      expect(s, file).toContain("<ClinicEntryDialog");
      expect(s, file).toContain("postClinicEntry(clinicId, entry)");
      expect(s, file).not.toContain("window.prompt");
      expect(s, file).not.toContain("askClinicEntry");
      expect(s, file).not.toContain("= WRITE");
    }
  });

  it("/admin, outside [locale], gets the dialog's messages", () => {
    const layout = src("src/app/admin/layout.tsx");
    expect(layout).toContain("NextIntlClientProvider");
    expect(layout).toContain("adminPlatform: { switcher: { entry } }");
  });
});

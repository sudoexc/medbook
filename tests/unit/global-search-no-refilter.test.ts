import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Audit CM-04: the ⌘K palette hid what /api/crm/search found. The dialog's
 * cmdk root filtered again, fuzzy-matching the query against each item's
 * `value` («patient-<id>-<name>-<phone>»). A phone read out in groups,
 * «90 123 45 67», scores 0 against «+998901234567», so the patient the
 * server found by digits vanished and the palette said «Ничего не найдено»;
 * «ФИО + год», a visit found by its comment and a doctor found by the uz
 * name went the same way. The results already are the server's answer, so
 * the palette must not filter them.
 */

const captured = vi.hoisted(() => ({ rootProps: [] as Array<Record<string, unknown>> }));

vi.mock("cmdk", async () => {
  const actual = await vi.importActual<typeof import("cmdk")>("cmdk");
  const R = await import("react");
  const box = ({ children }: { children?: React.ReactNode }) =>
    R.createElement("div", null, children);
  const Root = Object.assign(
    (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      captured.rootProps.push(props);
      return R.createElement("div", null, props.children);
    },
    {
      Input: () => R.createElement("input"),
      List: box,
      Empty: box,
      Group: box,
      Item: box,
      Separator: () => null,
    },
  );
  return { Command: Root, defaultFilter: actual.defaultFilter };
});
vi.mock("@/components/ui/dialog", async () => {
  const R = await import("react");
  const box = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(R.Fragment, null, children);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? R.createElement(R.Fragment, null, children) : null,
    DialogContent: box,
    DialogTitle: box,
    DialogDescription: box,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "ru" }),
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/components/layout/ai-ask-panel", () => ({ AiAskPanel: () => null }));

import { defaultFilter } from "cmdk";
import { CommandDialog } from "@/components/ui/command";
import { GlobalSearch } from "@/components/layout/global-search";

describe("⌘K global search keeps the server's hits", () => {
  it("cmdk's own filter would hide a patient found by a spaced phone or «ФИО + год»", () => {
    // Why the fix is needed: this is the score cmdk gives these hits.
    const value = "patient-p1-Каримова Нодира-+998901234567";
    expect(defaultFilter(value, "90 123 45 67")).toBe(0);
    expect(defaultFilter(value, "Каримова 1969")).toBe(0);
  });

  it("the global search dialog turns cmdk filtering off", () => {
    captured.rootProps = [];
    renderToStaticMarkup(
      React.createElement(GlobalSearch, { open: true, onOpenChange: () => {} }),
    );
    expect(captured.rootProps.length).toBeGreaterThan(0);
    expect(captured.rootProps.every((p) => p.shouldFilter === false)).toBe(true);
  });

  it("CommandDialog keeps cmdk's default filtering unless told otherwise", () => {
    captured.rootProps = [];
    renderToStaticMarkup(React.createElement(CommandDialog, { open: true }));
    expect(captured.rootProps[0]?.shouldFilter).toBeUndefined();
  });
});

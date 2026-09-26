/**
 * Audit CM-14 (mobile menu): «Записаться» in the phone menu did nothing.
 *
 * It was a bare <Button> with no handler and no LeadFormTrigger around it
 * (the desktop header had one), so a visitor on a phone who opened the
 * burger menu could not book from it. Pinned here:
 *   - the button closes the sheet and, once the sheet has finished closing,
 *     opens the booking form through its handle (the form sits outside the
 *     sheet, which unmounts its content when it closes);
 *   - opening through the handle runs the form's own open handler, so the
 *     same booking-open goal fires as for every other «Записаться»;
 *   - on the landing a section link waits for the sheet to close and then
 *     jumps; on any other page it is a plain link to the landing.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = Record<string, unknown>;

const captured = vi.hoisted(() => ({
  sheet: null as Props | null,
  buttons: [] as Props[],
  links: [] as Props[],
  leadForms: [] as Props[],
  dialogs: [] as Props[],
  handle: { open: vi.fn() },
  pathname: "/",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ru",
}));
vi.mock("@/components/layout/language-switcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("@/components/ui/sheet", async () => {
  const R = await import("react");
  const pass = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(R.Fragment, null, children);
  return {
    Sheet: (props: Props & { children?: React.ReactNode }) => {
      captured.sheet = props;
      return R.createElement("section", { "data-sheet": "" }, props.children);
    },
    SheetTrigger: () => null,
    SheetContent: pass,
    SheetTitle: pass,
  };
});
vi.mock("@/components/ui/button", async () => {
  const R = await import("react");
  return {
    Button: (props: Props & { children?: React.ReactNode }) => {
      captured.buttons.push(props);
      return R.createElement("button", null, props.children);
    },
  };
});
vi.mock("@/components/layout/site-section-link", async () => {
  const R = await import("react");
  return {
    useOnSiteHome: () => captured.pathname === "/",
    SiteSectionLink: (props: Props & { children?: React.ReactNode }) => {
      captured.links.push(props);
      return R.createElement("a", null, props.children);
    },
  };
});
vi.mock("@/components/sections/lead-form", async () => {
  const R = await import("react");
  return {
    createLeadFormHandle: () => captured.handle,
    LeadFormTrigger: (props: Props) => {
      captured.leadForms.push(props);
      return R.createElement("i", { "data-lead-form": "" });
    },
  };
});

const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/site-analytics", () => ({ reachGoal }));

beforeEach(() => {
  captured.sheet = null;
  captured.buttons = [];
  captured.links = [];
  captured.leadForms = [];
  captured.dialogs = [];
  captured.handle.open.mockReset();
  captured.pathname = "/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderNav(): Promise<string> {
  const { MobileNav } = await import("@/components/layout/mobile-nav");
  return renderToStaticMarkup(React.createElement(MobileNav));
}

function bookButton(): Props {
  const b = captured.buttons.at(-1);
  if (!b) throw new Error("no «Записаться» button rendered");
  return b;
}

describe("mobile menu «Записаться»", () => {
  it("has a handler now", async () => {
    await renderNav();
    expect(typeof bookButton().onClick).toBe("function");
  });

  it("opens the booking form once the sheet has closed, not before", async () => {
    await renderNav();
    (bookButton().onClick as () => void)();
    expect(captured.handle.open).not.toHaveBeenCalled();

    const complete = captured.sheet!.onOpenChangeComplete as (open: boolean) => void;
    complete(false);
    expect(captured.handle.open).toHaveBeenCalledTimes(1);
    expect(captured.handle.open).toHaveBeenCalledWith(null);

    // Runs once: the next close of the sheet opens nothing.
    complete(false);
    expect(captured.handle.open).toHaveBeenCalledTimes(1);
  });

  it("renders the form outside the sheet, bound to the same handle", async () => {
    const html = await renderNav();
    const inSheet = html.match(/<section data-sheet="">([\s\S]*)<\/section>/)?.[1] ?? "";
    expect(inSheet).not.toContain("data-lead-form");
    expect(html).toContain("data-lead-form");
    expect(captured.leadForms.at(-1)?.handle).toBe(captured.handle);
  });

  it("does not run a pending action after the sheet was reopened", async () => {
    await renderNav();
    (bookButton().onClick as () => void)();
    (captured.sheet!.onOpenChange as (open: boolean) => void)(true);
    (captured.sheet!.onOpenChangeComplete as (open: boolean) => void)(false);
    expect(captured.handle.open).not.toHaveBeenCalled();
  });
});

describe("the form opened through a handle", () => {
  it("fires booking-open like every other «Записаться»", async () => {
    vi.doMock("@/components/ui/dialog", async () => {
      const R = await import("react");
      const pass = ({ children }: { children?: React.ReactNode }) =>
        R.createElement(R.Fragment, null, children);
      return {
        Dialog: (props: Props & { children?: React.ReactNode }) => {
          captured.dialogs.push(props);
          return null;
        },
        DialogContent: pass,
        DialogHeader: pass,
        DialogTitle: pass,
        DialogTrigger: () => null,
      };
    });
    vi.doMock("@/components/providers/doctors-provider", () => ({ useDoctors: () => [] }));
    const actual = await vi.importActual<typeof import("@/components/sections/lead-form")>(
      "@/components/sections/lead-form",
    );
    const handle = actual.createLeadFormHandle();
    renderToStaticMarkup(React.createElement(actual.LeadFormTrigger, { handle }));

    const dialog = captured.dialogs.at(-1)!;
    expect(dialog.handle).toBe(handle);
    (dialog.onOpenChange as (open: boolean) => void)(true);
    expect(reachGoal).toHaveBeenCalledWith("booking-open");
  });
});

describe("mobile menu section links", () => {
  it("on the landing: waits for the sheet to close, then jumps to the section", async () => {
    const target = { scrollIntoView: vi.fn() };
    const getElementById = vi.fn(() => target);
    const replaceState = vi.fn();
    vi.stubGlobal("document", { getElementById });
    vi.stubGlobal("window", { history: { state: { __NA: true }, replaceState } });

    await renderNav();
    const doctors = captured.links.find((l) => l.section === "doctors")!;
    const preventDefault = vi.fn();
    (doctors.onClick as (e: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(target.scrollIntoView).not.toHaveBeenCalled();

    (captured.sheet!.onOpenChangeComplete as (open: boolean) => void)(false);
    expect(getElementById).toHaveBeenCalledWith("doctors");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    // The router's history state is kept; only the hash changes.
    expect(replaceState).toHaveBeenCalledWith({ __NA: true }, "", "#doctors");
  });

  it("on another page: an ordinary link, the browser loads the landing", async () => {
    captured.pathname = "/doctors/doc_1";
    await renderNav();
    const faq = captured.links.find((l) => l.section === "faq")!;
    const preventDefault = vi.fn();
    (faq.onClick as (e: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

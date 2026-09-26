/**
 * Audit CM-14 (links): the site menu is on every public page, the sections
 * it points at only on the landing.
 *
 * NAV_LINKS were bare hashes («#doctors»), used by the header, the mobile
 * sheet and the footer of the whole (site) layout. On a doctor's page or the
 * privacy policy «Врачи» pointed at a section that page does not have and
 * did nothing. Pinned here: on the landing a link stays a same-page hash
 * (no reload, the utm query survives); anywhere else it leads to the
 * landing of the current locale, "/" for ru and "/uz" for uz.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { siteHomePath, siteSectionHref } from "@/lib/site-nav";

const state = vi.hoisted(() => ({ locale: "ru", pathname: "/" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => state.locale,
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("@/components/providers/doctors-provider", () => ({
  useDoctors: () => [],
}));
vi.mock("next/image", async () => {
  const R = await import("react");
  return { default: (props: { alt: string }) => R.createElement("img", { alt: props.alt }) };
});
vi.mock("next/link", async () => {
  const R = await import("react");
  return {
    default: ({ href, children }: { href: string; children?: React.ReactNode }) =>
      R.createElement("a", { href }, children),
  };
});

beforeEach(() => {
  state.locale = "ru";
  state.pathname = "/";
});

function sectionHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*#(?:doctors|services|visit|faq))"/g)].map((m) => m[1]);
}

describe("siteSectionHref", () => {
  it("is a bare hash on the landing", () => {
    expect(siteSectionHref("doctors", "ru", true)).toBe("#doctors");
    expect(siteSectionHref("faq", "uz", true)).toBe("#faq");
  });

  it("leads to the landing of the locale from any other page", () => {
    expect(siteSectionHref("doctors", "ru", false)).toBe("/#doctors");
    expect(siteSectionHref("services", "uz", false)).toBe("/uz#services");
  });

  it("spells the landing the way the router serves it (ru unprefixed)", () => {
    expect(siteHomePath("ru")).toBe("/");
    expect(siteHomePath("uz")).toBe("/uz");
  });
});

describe("header and footer menu", () => {
  it("on a doctor's page (uz) every section link leads to /uz#…", async () => {
    state.locale = "uz";
    state.pathname = "/doctors/doc_1";
    const { Header } = await import("@/components/layout/header");
    const { Footer } = await import("@/components/layout/footer");
    const header = sectionHrefs(renderToStaticMarkup(React.createElement(Header)));
    const footer = sectionHrefs(renderToStaticMarkup(React.createElement(Footer)));

    expect(header).toEqual(["/uz#doctors", "/uz#services", "/uz#visit", "/uz#faq"]);
    expect(footer).toEqual(["/uz#doctors", "/uz#services", "/uz#visit", "/uz#faq"]);
  });

  it("on the privacy page (ru) they lead to /#…", async () => {
    state.pathname = "/privacy";
    const { Footer } = await import("@/components/layout/footer");
    const footer = sectionHrefs(renderToStaticMarkup(React.createElement(Footer)));
    expect(footer).toEqual(["/#doctors", "/#services", "/#visit", "/#faq"]);
  });

  it("on the landing they stay same-page hashes", async () => {
    const { Header } = await import("@/components/layout/header");
    const header = sectionHrefs(renderToStaticMarkup(React.createElement(Header)));
    expect(header).toEqual(["#doctors", "#services", "#visit", "#faq"]);
  });
});

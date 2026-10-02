/**
 * P6 group B2, the public site and its plumbing:
 *
 *   LD-11  GET /api/leads (names and phones of every site request, to any
 *          signed-in role) is gone; the CRM screen reads
 *          /api/crm/online-requests with its own roles.
 *   LD-12  The doctor's title carries the brand once, every public page has
 *          an og:image, the server HTML says lang="uz" on /uz, and a doctor
 *          card links to the page in the visitor's language.
 *   LD-13  robots.ts is the only robots.txt and closes the private paths
 *          without closing the public doctor pages.
 *   LD-14  Telegram Web may frame the Mini App (/c/); the rest stays
 *          unframeable.
 *   LD-16  The site links to the real bot.
 *   LD-17  The staff's dark theme applies on staff surfaces only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ locale: "ru" }));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
  useLocale: () => h.locale,
}));
vi.mock("next-intl/plugin", () => ({ default: () => (config: unknown) => config }));
vi.mock("@/components/sections/lead-form", () => ({
  LeadFormTrigger: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ sendNewLeadEmail: vi.fn() }));
vi.mock("@/lib/doctors", () => ({
  getDoctorById: vi.fn(async (id: string) => ({
    id,
    name: { ru: "Султанов Азиз", uz: "Sultanov Aziz" },
    specialty: { ru: "Невролог", uz: "Nevrolog" },
  })),
}));

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

import nextConfig from "../../next.config";
import robots from "@/app/robots";
import { CONTACT, TELEGRAM_BOT_USERNAME } from "@/lib/constants";
import { siteOpenGraph } from "@/lib/site-meta";
import { STAFF_THEMED_PATH, THEME_INIT_SCRIPT, staffThemeApplies } from "@/lib/theme-scope";
import { Doctors } from "@/components/sections/doctors";
import { TelegramShowcase } from "@/components/sections/telegram-showcase";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

beforeEach(() => {
  h.locale = "ru";
});

describe("LD-11: no role-less list of site requests", () => {
  it("the leads route answers POST only", async () => {
    const mod = await import("@/app/api/leads/route");
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof mod.POST).toBe("function");
    expect(read("src/app/api/leads/route.ts")).not.toMatch(/from "@\/lib\/auth"/);
  });

  it("the CRM list keeps the desk, call center and admin roles", () => {
    const src = read("src/app/api/crm/online-requests/route.ts");
    expect(src).toMatch(/roles: \[\.\.\.ONLINE_REQUEST_ROLES\]/);
  });
});

describe("LD-12: titles, preview picture, lang, doctor links", () => {
  it("the doctor's title is absolute: the brand once, not «| NeuroFax | NeuroFax»", async () => {
    const { generateMetadata } = await import("@/app/[locale]/(site)/doctors/[id]/page");
    const meta = (await generateMetadata({
      params: Promise.resolve({ locale: "uz", id: "d1" }),
    })) as { title: { absolute: string }; openGraph: { images: unknown } };
    expect(meta.title).toEqual({ absolute: "Sultanov Aziz | Nevrolog | NeuroFax" });
    expect(meta.title.absolute.match(/NeuroFax/g)).toHaveLength(1);
    expect(meta.openGraph.images).toEqual([
      { url: "/og-image.png", width: 1200, height: 630, alt: "NeuroFax" },
    ]);
  });

  it("every public page's Open Graph block carries the 1200x630 picture, which exists", () => {
    for (const locale of ["ru", "uz"]) {
      expect(siteOpenGraph(locale, "/privacy").images).toEqual([
        { url: "/og-image.png", width: 1200, height: 630, alt: "NeuroFax" },
      ]);
    }
    const file = path.join(process.cwd(), "public/og-image.png");
    expect(existsSync(file)).toBe(true);
    const png = readFileSync(file);
    // IHDR: width and height, big-endian, at bytes 16..24.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("the root layout renders <html lang> from the request locale", () => {
    const src = read("src/app/layout.tsx");
    expect(src).toMatch(/const locale = await getLocale\(\);/);
    expect(src).toMatch(/lang=\{locale\}/);
    expect(src).not.toMatch(/lang="ru"/);
  });

  it("a doctor card links to the page in the visitor's language", () => {
    const doctors = [
      {
        id: "d1",
        name: { ru: "Султанов Азиз", uz: "Sultanov Aziz" },
        specialty: { ru: "Невролог", uz: "Nevrolog" },
        bookable: false,
      },
    ] as unknown as Parameters<typeof Doctors>[0]["doctors"];
    h.locale = "uz";
    expect(renderToStaticMarkup(React.createElement(Doctors, { doctors }))).toContain(
      'href="/uz/doctors/d1"',
    );
    h.locale = "ru";
    expect(renderToStaticMarkup(React.createElement(Doctors, { doctors }))).toContain(
      'href="/doctors/d1"',
    );
  });
});

describe("LD-13: one robots.txt that closes the private paths", () => {
  const rules = robots().rules as { disallow: string[]; allow: string };
  // Prefix match, with "$" anchoring the end (Google, Yandex).
  const blocked = (p: string) =>
    rules.disallow.some((r) => (r.endsWith("$") ? p === r.slice(0, -1) : p.startsWith(r)));

  it("the static public/robots.txt that shadowed it is gone", () => {
    expect(existsSync(path.join(process.cwd(), "public/robots.txt"))).toBe(false);
  });

  it.each([
    "/api/leads",
    "/crm",
    "/crm/reception",
    "/uz/crm/calendar",
    "/doctor",
    "/doctor/visit/1",
    "/uz/doctor",
    "/uz/doctor/me",
    "/admin/clinics",
    "/login",
    "/signup",
    "/uz/signup",
    "/c/neurofax/my",
    "/q/tok",
    "/t/123",
    "/v/tok",
    "/ticket/abc",
    "/kiosk",
    "/tv",
  ])("closes %s", (p) => {
    expect(blocked(p)).toBe(true);
  });

  it.each(["/", "/uz", "/doctors/d1", "/uz/doctors/d1", "/privacy", "/uz/terms"])(
    "leaves the public %s open",
    (p) => {
      expect(blocked(p)).toBe(false);
    },
  );

  it("no longer lists the non-existent /dashboard/", () => {
    expect(rules.disallow).not.toContain("/dashboard/");
  });
});

describe("LD-14: Telegram Web may frame the Mini App, nothing else changes", () => {
  type Rule = { source: string; headers: Array<{ key: string; value: string }> };

  async function headersFor(pathname: string): Promise<Record<string, string>> {
    const rules = (await nextConfig.headers!()) as Rule[];
    const out: Record<string, string> = {};
    // Next applies every matching rule in order; a later key wins.
    for (const rule of rules) {
      const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true });
      if (match(pathname) === false) continue;
      for (const { key, value } of rule.headers) out[key] = value;
    }
    return out;
  }

  const frameAncestors = (csp: string) => /frame-ancestors ([^;]+)/.exec(csp)?.[1];

  it("the Mini App: frame-ancestors adds web.telegram.org, no X-Frame-Options", async () => {
    const h = await headersFor("/c/neurofax/my");
    expect(frameAncestors(h["Content-Security-Policy"]!)).toBe("'self' https://web.telegram.org");
    expect(h["X-Frame-Options"]).toBeUndefined();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  it.each(["/crm", "/uz/crm/reception", "/doctor/visit/1", "/api/miniapp/appointments", "/login"])(
    "%s stays unframeable: SAMEORIGIN and frame-ancestors 'self'",
    async (p) => {
      const h = await headersFor(p);
      expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
      expect(frameAncestors(h["Content-Security-Policy"]!)).toBe("'self'");
    },
  );

  it("the landing keeps its Metrika framers and SAMEORIGIN", async () => {
    const h = await headersFor("/");
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(frameAncestors(h["Content-Security-Policy"]!)).toMatch(/^'self' https:\/\/metrika\.yandex\.ru/);
    expect(frameAncestors(h["Content-Security-Policy"]!)).not.toMatch(/telegram/);
  });
});

describe("LD-16: the site links to the real bot", () => {
  it("CONTACT.telegram is the bot's t.me link, and the showcase names the same bot", () => {
    expect(CONTACT.telegram).toBe(`https://t.me/${TELEGRAM_BOT_USERNAME}`);
    expect(ru.tgShowcase.botHandle).toBe(`@${TELEGRAM_BOT_USERNAME}`);
    expect(uz.tgShowcase.botHandle).toBe(`@${TELEGRAM_BOT_USERNAME}`);
  });

  it("the showcase has a button into the bot, in both languages", () => {
    const html = renderToStaticMarkup(React.createElement(TelegramShowcase));
    expect(html).toContain('href="https://t.me/neurofaxbot"');
    expect(html).toContain("tgShowcase.cta");
    expect(ru.tgShowcase.cta).toBeTruthy();
    expect(uz.tgShowcase.cta).toBeTruthy();
    for (const s of [ru.tgShowcase.cta, uz.tgShowcase.cta]) expect(s).not.toMatch(/[—–]/);
  });

  it("the footer shows Telegram unconditionally", () => {
    const src = read("src/components/layout/footer.tsx");
    expect(src).not.toMatch(/CONTACT\.telegram !== "#"/);
    expect(src.match(/href=\{CONTACT\.telegram\}/g)).toHaveLength(2);
  });
});

describe("LD-17: the staff theme stays on staff surfaces", () => {
  it.each(["/crm", "/crm/reception", "/uz/crm", "/ru/crm/calendar", "/doctor", "/doctor/visit/1", "/uz/doctor/me", "/admin", "/admin/clinics", "/login"])(
    "%s follows the stored choice",
    (p) => {
      expect(staffThemeApplies(p)).toBe(true);
    },
  );

  it.each(["/", "/uz", "/ru", "/doctors/d1", "/uz/doctors/d1", "/privacy", "/uz/terms", "/signup", "/c/neurofax/my", "/q/tok", "/t/1", "/v/tok", "/crmx", "/doctorx", "/kiosk", "/tv"])(
    "%s is always light",
    (p) => {
      expect(staffThemeApplies(p)).toBe(false);
    },
  );

  it("treats a missing pathname as public", () => {
    expect(staffThemeApplies(null)).toBe(false);
    expect(staffThemeApplies(undefined)).toBe(false);
  });

  function runInit(pathname: string, stored: string | null, osDark = false) {
    const classes = new Set<string>();
    const root = {
      classList: { add: (c: string) => classes.add(c) },
      style: { colorScheme: "" },
    };
    vm.runInNewContext(THEME_INIT_SCRIPT, {
      location: { pathname },
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: osDark }),
      document: { documentElement: root },
      RegExp,
    });
    return { dark: classes.has("dark"), scheme: root.style.colorScheme };
  }

  it("the pre-paint script paints dark only on a staff surface", () => {
    expect(runInit("/crm/reception", "dark")).toEqual({ dark: true, scheme: "dark" });
    expect(runInit("/doctor", "system", true)).toEqual({ dark: true, scheme: "dark" });
    expect(runInit("/", "dark")).toEqual({ dark: false, scheme: "light" });
    expect(runInit("/uz/doctors/d1", "dark")).toEqual({ dark: false, scheme: "light" });
    expect(runInit("/crm", "light")).toEqual({ dark: false, scheme: "light" });
    expect(runInit("/crm", null)).toEqual({ dark: false, scheme: "light" });
  });

  it("the script and the provider share one rule", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(STAFF_THEMED_PATH.source));
    const provider = read("src/components/providers/theme-provider.tsx");
    expect(provider).toMatch(/staffThemeApplies\(pathname\)/);
    expect(read("src/app/layout.tsx")).toMatch(/__html: THEME_INIT_SCRIPT/);
    expect(read("src/components/ui/sonner.tsx")).toMatch(/theme=\{resolvedTheme\}/);
  });
});

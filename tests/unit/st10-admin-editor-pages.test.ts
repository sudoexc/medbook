/**
 * Audit ST-10: /crm/services and /crm/rooms are the admin editors the
 * settings overview links to, but they live outside the settings layout and
 * its ADMIN check. The front desk opening one by URL got a full editor
 * whose every save failed; now they are sent back to /crm like the rest of
 * the settings section.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | { user: { role: string } },
  redirects: [] as Array<{ href: string; locale: string }>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/i18n/navigation", () => ({
  redirect: (to: { href: string; locale: string }) => {
    h.redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to.href}`);
  },
}));
vi.mock("@/app/[locale]/crm/settings/services/_components/services-settings-client", () => ({
  ServicesSettingsClient: () => null,
}));
vi.mock("@/app/[locale]/crm/settings/cabinets/_components/cabinets-settings-client", () => ({
  CabinetsSettingsClient: () => null,
}));

import ServicesPage from "@/app/[locale]/crm/services/page";
import RoomsPage from "@/app/[locale]/crm/rooms/page";

const params = Promise.resolve({ locale: "ru" });

beforeEach(() => {
  h.session = null;
  h.redirects = [];
});

describe.each([
  ["/crm/services", ServicesPage],
  ["/crm/rooms", RoomsPage],
])("%s", (_path, Page) => {
  it.each(["RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"])(
    "sends %s back to /crm",
    async (role) => {
      h.session = { user: { role } };
      await expect(Page({ params })).rejects.toThrow("NEXT_REDIRECT /crm");
      expect(h.redirects).toEqual([{ href: "/crm", locale: "ru" }]);
    },
  );

  it("sends a signed-out visitor to the login", async () => {
    await expect(Page({ params })).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it.each(["ADMIN", "SUPER_ADMIN"])("opens the editor for %s", async (role) => {
    h.session = { user: { role } };
    await expect(Page({ params })).resolves.toBeTruthy();
    expect(h.redirects).toEqual([]);
  });
});

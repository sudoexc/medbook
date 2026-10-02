/**
 * Persist a staff member's UI language choice (client-only).
 *
 * Two stores, both needed:
 *   - the `NEXT_LOCALE` cookie, written eagerly so the choice holds before
 *     the locale navigation resolves;
 *   - `User.preferredLocale` via PATCH /api/me, because sign-in re-seeds the
 *     cookie from that column (src/lib/auth.ts, default "ru"). The CRM
 *     topbar wrote only the cookie, so Uzbek reverted to Russian at every
 *     login (audit CM-24).
 *
 * The PATCH is best-effort: public pages get a harmless 401 and a VIEW_ONLY
 * impersonation a 403; neither may block the language change.
 */
export type UiLocale = "ru" | "uz";

export function persistUiLocale(next: UiLocale): void {
  document.cookie = `NEXT_LOCALE=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  void fetch("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: next }),
  }).catch(() => {});
}

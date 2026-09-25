/**
 * Public clinic self-signup: off unless explicitly switched on (audit MA-03).
 *
 * The flow was a mock that looked finished. «Check your email» sent nothing;
 * the confirm token came back in the POST response and the form showed the
 * link, so anyone could create a clinic tenant plus an ADMIN on the
 * production database under any email address, by script, thousands of times.
 * That database holds a real clinic's patients.
 *
 * Now:
 *   - `PUBLIC_SIGNUP_ENABLED=1` must be set, or /signup, /signup/confirm/… and
 *     both /api/public/signup* endpoints answer 404;
 *   - even when enabled the token never leaves the server except inside the
 *     confirmation email, so owning the inbox is the proof;
 *   - in production the request is refused when email delivery is not
 *     configured (a link nobody can receive is worse than no signup);
 *   - requests are rate-limited per real client IP and per email.
 *
 * Still to do before switching it on for the public: a CAPTCHA and a
 * SUPER_ADMIN review of new tenants.
 */
import { createTranslator } from "next-intl";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

export function isPublicSignupEnabled(): boolean {
  const v = process.env.PUBLIC_SIGNUP_ENABLED;
  return v === "1" || v === "true";
}

/** The response of a switched-off endpoint: indistinguishable from no route. */
export function signupDisabledResponse(): Response {
  return Response.json({ error: "NotFound" }, { status: 404 });
}

export function signupEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export const SIGNUP_LIMITS = {
  perIpPerHour: 5,
  perEmailPerHour: 3,
} as const;

/** Absolute confirm link for the email. */
export function signupConfirmUrl(args: {
  requestUrl: string;
  locale: "ru" | "uz";
  token: string;
}): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    new URL(args.requestUrl).origin;
  const localePath = args.locale === "ru" ? "" : `/${args.locale}`;
  return `${base}${localePath}/signup/confirm/${encodeURIComponent(args.token)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subject + HTML of the confirmation email, in the applicant's language. */
export function renderSignupConfirmEmail(args: {
  locale: "ru" | "uz";
  clinicName: string;
  confirmUrl: string;
}): { subject: string; html: string } {
  const t = createTranslator({
    locale: args.locale,
    messages: args.locale === "uz" ? uz : ru,
    namespace: "signup.email",
  });
  const clinicName = args.clinicName;
  const url = escapeHtml(args.confirmUrl);
  const html = `
      <div style="font-family: sans-serif; max-width: 480px;">
        <p>${escapeHtml(t("greeting"))}</p>
        <p>${escapeHtml(t("body", { clinicName }))}</p>
        <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;">${escapeHtml(t("cta"))}</a></p>
        <p style="color:#666;font-size:13px;word-break:break-all;">${url}</p>
        <p style="color:#666;font-size:13px;">${escapeHtml(t("ignore"))}</p>
      </div>
    `;
  return { subject: t("subject", { clinicName }), html };
}

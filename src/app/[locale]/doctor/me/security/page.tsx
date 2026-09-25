/**
 * /doctor/me/security — TOTP enrolment for doctors (audit DC-02). Same page
 * as /crm/me/security, served inside the cabinet because the CRM layout sends
 * every doctor back to /doctor. With «2FA for everyone» on, the proxy sends a
 * doctor who has not enrolled yet here instead of leaving the cabinet dead on
 * 403 MFA_REQUIRED.
 */
export { default } from "@/app/[locale]/crm/me/security/page";

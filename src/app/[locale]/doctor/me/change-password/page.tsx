/**
 * /doctor/me/change-password — the doctor's own password change (audit
 * DC-02). Same page as /crm/me/change-password, served inside the cabinet
 * because the CRM layout sends every doctor back to /doctor. The proxy
 * forces doctors with a temporary password here.
 */
export { default } from "@/app/[locale]/crm/me/change-password/page";

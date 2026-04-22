import { SmsPageClient } from "./_components/sms-page-client";

/**
 * /crm/sms — MVP SMS inbox. Mirrors the Telegram inbox API + shape but
 * with minimal UI: conversation list + last-message preview + detail link.
 *
 * Full 3-pane parity (list / chat / rail) will be delivered by extracting
 * shared messaging components in Phase 6.
 */
export default function SmsInboxPage() {
  return <SmsPageClient />;
}

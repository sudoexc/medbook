import { OnlineRequestsClient } from "./_components/online-requests-client";

/**
 * /crm/online-requests — «Заявки»: booking requests from the public site
 * (docs/TZ.md §7.2, audit LD-01).
 *
 * Thin server shell. Access is enforced by the API (ADMIN / RECEPTIONIST /
 * CALL_OPERATOR); other roles see a «no access» note in the client.
 */
export default function OnlineRequestsPage() {
  return <OnlineRequestsClient />;
}

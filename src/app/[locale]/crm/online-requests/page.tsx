import { auth } from "@/lib/auth";

import { OnlineRequestsClient } from "./_components/online-requests-client";

/**
 * /crm/online-requests — «Заявки»: booking requests from the public site
 * (docs/TZ.md §7.2, audit LD-01).
 *
 * Thin server shell. Access is enforced by the API (ADMIN / RECEPTIONIST /
 * CALL_OPERATOR); other roles see a «no access» note in the client.
 */
export default async function OnlineRequestsPage() {
  const session = await auth();
  // Creating the appointment is a reception action (POST /api/crm/
  // appointments does not admit CALL_OPERATOR): the operator works the
  // request by phone and hands it over instead of meeting a 403.
  const canBook = session?.user?.role !== "CALL_OPERATOR";
  return <OnlineRequestsClient canBook={canBook} />;
}

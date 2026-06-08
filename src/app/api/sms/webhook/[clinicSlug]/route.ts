/**
 * /api/sms/webhook/[clinicSlug] — REMOVED (SMS removal Wave 1).
 *
 * Returns 200 OK no-op for any inbound POST. Eskiz / Playmobile (or any
 * other provider still pointed at us) won't retry the delivery and won't
 * flood the bug tracker with 5xx alerts. Nothing is written to the DB:
 * no Conversation, no Message, no audit row, no confirmAppointment.
 *
 * Full deletion of the route file follows in Wave 3 once we know nothing
 * in the wild is still POSTing here. Until then, keep the file so existing
 * deployments don't 404.
 *
 * See `docs/TZ-sms-removal.md` §3.8 / §4 (Wave 1).
 */
import { NextResponse } from "next/server";

// `_req` is accepted (not used) so legacy tests calling `POST(req)` still
// compile under the route's removed handler — the tests themselves are
// deleted in Wave 3.
export async function POST(_req: Request): Promise<NextResponse> {
  return NextResponse.json({ ok: true, removed: true }, { status: 200 });
}

export async function GET(_req: Request): Promise<NextResponse> {
  return NextResponse.json({ ok: true, removed: true }, { status: 200 });
}

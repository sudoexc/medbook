/**
 * POST /api/miniapp/conversations/find-or-create?clinicSlug=…
 *
 * Patient opens (or reopens) their thread with the clinic from the Mini App.
 * Delegates to the shared `findOrCreateConversation` helper with
 * `initiatorRole: "PATIENT"` so the audit + outbox path matches what the CRM
 * uses for every other channel.
 *
 * Body: none. Returns `{ conversationId, channel, created }`.
 *
 * Channel preference: TG (the patient is in the bot Mini App right now, so
 * staff replies should route back through the same conversation surface).
 * SMS fallback applies when the patient profile has no `telegramId` for some
 * reason.
 */
import { runWithTenant } from "@/lib/tenant-context";
import { err, ok } from "@/server/http";
import { findOrCreateConversation } from "@/server/conversations/find-or-create";
import { resolveMiniAppContext } from "@/server/miniapp/handler";

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const result = await findOrCreateConversation({
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      initiatorRole: "PATIENT",
      initiatorUserId: null,
      assigneeUserId: null,
      surface: "MINIAPP",
      preferredChannel: "TG",
    });
    if (!result.ok) {
      const reason = result.reason;
      const status = reason === "no_channel" ? 422 : 404;
      return err("Unavailable", status, { reason });
    }
    return ok(
      {
        conversationId: result.conversation.id,
        channel: result.conversation.channel,
        created: result.created,
      },
      result.created ? 201 : 200,
    );
  });
}

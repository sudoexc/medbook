/**
 * Which threads a caller may open by id (audit TG-32).
 *
 * The inbox list kept a doctor inside his caseload, but every route under
 * /conversations/[id] (messages, the PATCH, the composer's templates and
 * uploads) checked only the clinic. A doctor holding a thread id from a
 * toast, a colleague's link or the list with a colleague's `doctorId` read
 * and wrote another doctor's patient correspondence.
 *
 * The rule is the inbox's own (`doctorConversationScope`): the desk roles
 * see the clinic's threads, a doctor his caseload. A doctor account with no
 * Doctor row keeps the clinic-wide view, as the list always gave it.
 */
import { prisma } from "@/lib/prisma";
import type { TenantContext } from "@/lib/tenant-context";

import { doctorConversationScope } from "./doctor-scope";

export type ConversationAccess = {
  /** Spread into a `conversation` where next to the `id`. */
  where: Record<string, unknown>;
  /** The caller's Doctor row, when the caller is a doctor. */
  doctorId: string | null;
};

/** The caller's thread scope, or null when there is no clinic to scope to. */
export async function conversationAccess(
  ctx: TenantContext,
): Promise<ConversationAccess | null> {
  if (ctx.kind !== "TENANT") return null;
  const where: Record<string, unknown> = { clinicId: ctx.clinicId };
  if (ctx.role !== "DOCTOR") return { where, doctorId: null };
  const doc = await prisma.doctor.findFirst({
    where: { userId: ctx.userId },
    select: { id: true },
  });
  if (!doc) return { where, doctorId: null };
  where.AND = [{ OR: doctorConversationScope(doc.id, ctx.userId) }];
  return { where, doctorId: doc.id };
}

/** Is this thread one the caller may open? */
export async function canOpenConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<boolean> {
  const access = await conversationAccess(ctx);
  if (!access || !conversationId) return false;
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, ...access.where },
    select: { id: true },
  });
  return row != null;
}

/**
 * /api/crm/conversations/[id]/templates — the composer's «Шаблоны» (audit
 * G6-04).
 *
 * GET lists the clinic's Telegram templates for the picker. It lives next to
 * the thread, for every role that may write in it: the admin templates API
 * is ADMIN/RECEPTIONIST/CALL_OPERATOR only, so a nurse or a doctor opened
 * the picker, got a 403 and read «Нет шаблонов».
 *
 * POST { templateId, lang? } fills one template for this thread on the
 * server (`fillTemplateForConversation`): the patient's card, the visit the
 * template is about and the clinic, in the patient's language. `lang` is the
 * operator's language, used only for a thread with no card. A placeholder
 * with no data answers 422 `TemplateUnresolved` with the reason and the
 * fields, and nothing is inserted: the patient never gets braces.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";
import { fillTemplateForConversation } from "@/server/conversations/template-fill";

const ROLES = [
  "ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "CALL_OPERATOR",
] as const;

const FillSchema = z.object({
  templateId: z.string().min(1),
  lang: z.enum(["ru", "uz"]).optional(),
});

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/templates
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: [...ROLES] },
  async ({ request, ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return notFound();
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationIdFromUrl(request), clinicId },
      select: { id: true },
    });
    if (!conv) return notFound();
    const rows = await prisma.notificationTemplate.findMany({
      where: { clinicId, channel: "TG" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        key: true,
        nameRu: true,
        nameUz: true,
        channel: true,
        bodyRu: true,
        bodyUz: true,
      },
    });
    return ok({ rows });
  },
);

export const POST = createApiHandler(
  { roles: [...ROLES], bodySchema: FillSchema },
  async ({ request, body, ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return notFound();
    const result = await fillTemplateForConversation({
      clinicId,
      conversationId: conversationIdFromUrl(request),
      templateId: body.templateId,
      fallbackLang: body.lang ?? "ru",
    });
    if (!result) return notFound();
    if (!result.ok) {
      return err("TemplateUnresolved", 422, {
        reason: result.reason,
        fields: result.fields,
      });
    }
    return ok({ body: result.body, lang: result.lang });
  },
);

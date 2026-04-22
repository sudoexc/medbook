/**
 * /api/crm/notifications/triggers — list the 7 hard-coded triggers plus
 * the template each clinic has wired up for them.
 *
 * A "trigger" is defined in code (see `src/server/notifications/triggers.ts`)
 * and linked to a template by matching `template.key` verbatim. The UI
 * shows per-trigger toggles that flip the linked template's `isActive`.
 *
 * There's no `TriggerConfig` model today — if we later need per-trigger
 * delay overrides or enable/disable state independent of templates,
 * that's a request for `prisma-schema-owner` (see LOG.md Phase 3a
 * TODOs).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { TRIGGER_KEYS } from "@/server/notifications/triggers";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async () => {
    const templates = await prisma.notificationTemplate.findMany({
      where: { key: { in: [...TRIGGER_KEYS] } },
      select: {
        id: true,
        key: true,
        isActive: true,
        channel: true,
        nameRu: true,
        nameUz: true,
      },
    });
    const byKey = new Map(templates.map((t) => [t.key, t]));
    const rows = TRIGGER_KEYS.map((k) => ({
      key: k,
      template: byKey.get(k) ?? null,
      active: byKey.get(k)?.isActive ?? false,
    }));
    return ok({ rows });
  },
);

/**
 * /api/crm/settings/notifications/templates/[id] — settings editor PATCH.
 *
 * Phase 8b/c: ADMIN updates the body (RU/UZ) and/or rules
 * (triggerConfig.offsetMin, channels, enabled). Other template fields are
 * managed via the existing /api/crm/notifications/templates/[id] route.
 *
 * Validation:
 *   - Reject unknown placeholders against ALLOWED_KEYS_BY_TRIGGER for the
 *     row's logical trigger (computed server-side from `trigger` enum +
 *     existing triggerConfig.offsetMin).
 *   - Reject empty bodies (server-side guard mirroring UI).
 *   - Sanitize triggerConfig (clamp offsetMin, normalize channels).
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { validate } from "@/server/notifications/template";
import {
  allowedKeysFor,
  logicalTriggerKey,
  sanitizeTriggerConfig,
} from "@/server/notifications/rules";

const PatchSchema = z.object({
  bodyRu: z.string().min(0).max(10_000).optional(),
  bodyUz: z.string().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  triggerConfig: z
    .object({
      offsetMin: z.number().int().optional().nullable(),
      channels: z.array(z.enum(["TG", "SMS"])).optional().nullable(),
      enabled: z.boolean().optional().nullable(),
      days: z.number().int().optional().nullable(),
    })
    .partial()
    .passthrough()
    .optional(),
});

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: PatchSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationTemplate.findUnique({
      where: { id },
    });
    if (!before) return notFound();

    const logical = logicalTriggerKey(
      before.trigger,
      before.triggerConfig,
      before.key,
    );
    const allowed = allowedKeysFor(logical);

    const data: Record<string, unknown> = {};

    if (typeof body.bodyRu === "string") {
      const trimmed = body.bodyRu.trim();
      if (trimmed.length === 0) {
        return err("EmptyBody", 400, { field: "bodyRu" });
      }
      const v = validate(body.bodyRu, allowed);
      if (!v.ok) {
        return err("UnknownPlaceholder", 400, {
          field: "bodyRu",
          unknown: v.unknown,
          allowed,
        });
      }
      data.bodyRu = body.bodyRu;
    }

    if (typeof body.bodyUz === "string") {
      const trimmed = body.bodyUz.trim();
      if (trimmed.length === 0) {
        return err("EmptyBody", 400, { field: "bodyUz" });
      }
      const v = validate(body.bodyUz, allowed);
      if (!v.ok) {
        return err("UnknownPlaceholder", 400, {
          field: "bodyUz",
          unknown: v.unknown,
          allowed,
        });
      }
      data.bodyUz = body.bodyUz;
    }

    if (typeof body.isActive === "boolean") {
      data.isActive = body.isActive;
    }

    if (body.triggerConfig !== undefined) {
      const kind = before.trigger === "APPOINTMENT_BEFORE" ? "before" : "other";
      const merged = {
        ...(before.triggerConfig &&
        typeof before.triggerConfig === "object" &&
        !Array.isArray(before.triggerConfig)
          ? (before.triggerConfig as Record<string, unknown>)
          : {}),
        ...body.triggerConfig,
      };
      data.triggerConfig = sanitizeTriggerConfig(merged, { kind });

      // Mirror channels[0] onto template.channel so the existing materializer
      // (which reads template.channel) picks the user's primary choice.
      const cfg = data.triggerConfig as { channels?: Array<"TG" | "SMS"> };
      if (Array.isArray(cfg.channels) && cfg.channels.length > 0) {
        data.channel = cfg.channels[0];
      }
    }

    if (Object.keys(data).length === 0) {
      return err("EmptyPatch", 400);
    }

    const after = await prisma.notificationTemplate.update({
      where: { id },
      data: data as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await audit(request, {
      action: "settings.notifications.template.update",
      entityType: "NotificationTemplate",
      entityId: id,
      meta: d,
    });
    return ok(after);
  },
);

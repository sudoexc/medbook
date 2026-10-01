/**
 * Create a clinic's copy of a default template on first use.
 *
 * Clinics are not seeded automatically: a template that only a manual script
 * creates is a template most clinics never get, and a worker that silently
 * finds none sends nothing (AP-02 for «Напомнить всем», TG-09 for the
 * pre-visit questionnaire and the visit rating, TG-15 for medication
 * reminders). `update: {}` keeps an admin's edits, the switched-off flag
 * included: a template turned off stays off.
 *
 * `activeOnCreate` decides only how a brand-new row starts: a patient
 * message the clinic has not chosen to send yet (a restored visit, an
 * amended conclusion) appears in the settings switched off (G3-03).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import type { DefaultTemplate } from "./default-templates";

export type EnsuredTemplate = {
  id: string;
  bodyRu: string;
  bodyUz: string;
  channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  isActive: boolean;
  triggerConfig: unknown;
};

export async function ensureClinicTemplate(
  clinicId: string,
  tpl: DefaultTemplate,
  opts: { activeOnCreate?: boolean } = {},
): Promise<EnsuredTemplate> {
  const select = {
    id: true,
    bodyRu: true,
    bodyUz: true,
    channel: true,
    isActive: true,
    triggerConfig: true,
  } as const;
  const upsert = () =>
    runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationTemplate.upsert({
        where: { clinicId_key: { clinicId, key: tpl.key } },
        create: {
          clinicId,
          key: tpl.key,
          nameRu: tpl.nameRu,
          nameUz: tpl.nameUz,
          channel: tpl.channel,
          category: tpl.category,
          trigger: tpl.trigger,
          triggerConfig: (tpl.triggerConfig ?? undefined) as never,
          bodyRu: tpl.bodyRu,
          bodyUz: tpl.bodyUz,
          variables: tpl.variables,
          isActive: opts.activeOnCreate ?? true,
        },
        update: {},
        select,
      }),
    );
  let row;
  try {
    row = await upsert();
  } catch (e) {
    // Two callers at once: the loser of the insert race reads the row the
    // winner created.
    if ((e as { code?: unknown } | null)?.code !== "P2002") throw e;
    row = await upsert();
  }
  return row as EnsuredTemplate;
}

/**
 * One active template per automatic message (audit TG-22).
 *
 * Every surface that saves a template (the template editor, «Настройки
 * уведомлений», the «Авто-сообщения» widget, the «Триггеры» switch) calls
 * `retireSlotRivals` after the write, in the same transaction: the other
 * active templates of the saved one's slot (see `templateSlot`) are switched
 * off. Two active rows for «за 24 часа» used to leave the dispatcher to pick
 * one at random, so switching the widget's row off did not stop the
 * reminder and its edited text did not reach patients.
 */
import { templateSlot } from "./template-events";

type TemplateRow = {
  id: string;
  clinicId: string;
  key: string;
  trigger: string;
  triggerConfig: unknown;
  isActive: boolean;
};

/** The template calls of a Prisma client or transaction this module needs. */
export type TemplateSlotDb = {
  notificationTemplate: {
    findUnique(args: {
      where: { id: string };
      select: Record<string, true>;
    }): Promise<unknown>;
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, true>;
    }): Promise<unknown[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: { isActive: boolean };
    }): Promise<{ count: number }>;
  };
};

const SELECT = {
  id: true,
  clinicId: true,
  key: true,
  trigger: true,
  triggerConfig: true,
  isActive: true,
} as const;

/** The other templates of the clinic in `slot`, active ones only by default. */
export async function slotTemplates(
  db: TemplateSlotDb,
  clinicId: string,
  slot: string,
  opts: { activeOnly?: boolean; exceptId?: string } = {},
): Promise<TemplateRow[]> {
  const rows = (await db.notificationTemplate.findMany({
    where: {
      clinicId,
      ...(opts.activeOnly === false ? {} : { isActive: true }),
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    select: SELECT,
  })) as TemplateRow[];
  return rows.filter((r) => templateSlot(r) === slot);
}

/**
 * Switch off every other active template in the slot of `templateId`, if it
 * is active and has a slot. Returns the ids switched off (for the audit).
 */
export async function retireSlotRivals(
  db: TemplateSlotDb,
  templateId: string,
): Promise<string[]> {
  const tpl = (await db.notificationTemplate.findUnique({
    where: { id: templateId },
    select: SELECT,
  })) as TemplateRow | null;
  if (!tpl || !tpl.isActive) return [];
  const slot = templateSlot(tpl);
  if (!slot) return [];
  const rivals = (await slotTemplates(db, tpl.clinicId, slot, { exceptId: tpl.id })).map(
    (r) => r.id,
  );
  if (rivals.length > 0) {
    await db.notificationTemplate.updateMany({
      where: { id: { in: rivals }, clinicId: tpl.clinicId },
      data: { isActive: false },
    });
  }
  return rivals;
}

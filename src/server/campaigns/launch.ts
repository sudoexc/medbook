/**
 * Reactivation campaign launcher.
 *
 * Called by `POST /api/crm/campaigns/[id]/launch`. The whole materialise +
 * status-flip + action-close happens inside a single Prisma transaction so a
 * mid-flight crash leaves the campaign back in DRAFT with zero NotificationSend
 * rows. The actual delivery jobs are enqueued AFTER the transaction commits;
 * if enqueue throws we don't roll back the campaign (the QUEUED rows can be
 * retried via the notifications scheduler or manual /retry endpoint).
 *
 * Idempotency: re-launching a campaign that is already SENDING or SENT is
 * a no-op that returns the prior totals. Inside the tx the DRAFT → SENDING
 * flip is ONE conditional update and the sends are inserted only by the
 * caller that won it (audit TG-10): a read-then-update let two concurrent
 * launches both see DRAFT and both insert a full set of sends.
 */
import { prisma } from "@/lib/prisma";
import type { NotificationStatus } from "@/generated/prisma/client";

import { resolveAudience } from "./audience";
import { renderBroadcastBody } from "./broadcast-body";
import type { AudiencePatient } from "./dormant-audience";
import type { CampaignChannel, CampaignSegment } from "@/server/schemas/campaign";
import { enqueueDelivery } from "@/server/workers/notifications-send";

// The DB `Channel` enum still carries "SMS" until the Wave 5 migration
// of `docs/TZ-sms-removal.md`. Legacy Campaign rows with channel="SMS"
// remain readable, but the launcher refuses to start them (see status
// guard below).
type CampaignRow = {
  id: string;
  clinicId: string;
  name: string;
  channel: "TG" | "SMS" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  status: string;
  templateId: string | null;
  body: string | null;
  segment: unknown;
  scheduledFor: Date | null;
  totalCount: number;
};

type TemplateRow = {
  id: string;
  bodyRu: string;
  bodyUz: string;
};

type ClinicRow = {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
};

export type LaunchResult = {
  campaignId: string;
  status: string;
  totalCount: number;
  alreadyLaunched: boolean;
  /** When set in the future, delivery is deferred to the notifications scheduler. */
  scheduledFor: Date | null;
  deferred: boolean;
};

function pickBodyTemplate(template: TemplateRow, lang: "RU" | "UZ"): string {
  return lang === "UZ" ? template.bodyUz : template.bodyRu;
}

function recipientFor(channel: CampaignChannel, patient: AudiencePatient): string | null {
  if (channel === "TG") return patient.telegramId;
  return null;
}

/**
 * Materialise NotificationSend rows for the campaign's audience and flip the
 * campaign into SENDING. Returns `{ alreadyLaunched: true }` if the row is
 * already past DRAFT.
 *
 * The caller is expected to have validated RBAC + ownership; this function
 * assumes the campaign belongs to the active clinic.
 */
export async function launchCampaign(args: {
  campaignId: string;
  sourceActionId?: string | null;
  now?: Date;
}): Promise<LaunchResult> {
  const now = args.now ?? new Date();

  // Read upfront — these don't need to be inside the tx because the launch
  // gate inside the tx re-checks the campaign row by id and bumps status under
  // a lock-equivalent (status === 'DRAFT' guard).
  const campaign = (await prisma.campaign.findUnique({
    where: { id: args.campaignId },
  })) as CampaignRow | null;
  if (!campaign) {
    throw Object.assign(new Error("CampaignNotFound"), { status: 404 });
  }
  if (campaign.status !== "DRAFT") {
    return {
      campaignId: campaign.id,
      status: campaign.status,
      totalCount: campaign.totalCount,
      alreadyLaunched: true,
      scheduledFor: campaign.scheduledFor,
      deferred: false,
    };
  }
  // Campaigns are TG-only after `docs/TZ-sms-removal.md` Wave 3.
  // Legacy SMS rows that never finished launching get a clean refusal
  // here instead of materialising sends the dispatcher can't deliver.
  if (campaign.channel !== "TG") {
    throw Object.assign(
      new Error(`UnsupportedChannel:${campaign.channel}`),
      { status: 400 },
    );
  }

  const segment = campaign.segment as CampaignSegment | null;
  if (!segment) {
    throw Object.assign(new Error("UnsupportedSegmentKind"), { status: 400 });
  }

  // Inline body (ad-hoc broadcast) wins over a saved template. Either one is
  // required — the launcher refuses to materialise empty sends.
  const inlineBody =
    campaign.body && campaign.body.trim().length > 0 ? campaign.body : null;

  const [template, clinic] = await Promise.all([
    campaign.templateId
      ? (prisma.notificationTemplate.findUnique({
          where: { id: campaign.templateId },
          select: { id: true, bodyRu: true, bodyUz: true },
        }) as Promise<TemplateRow | null>)
      : Promise.resolve(null),
    prisma.clinic.findUnique({
      where: { id: campaign.clinicId },
      select: {
        nameRu: true,
        nameUz: true,
        phone: true,
        addressRu: true,
        addressUz: true,
      },
    }) as Promise<ClinicRow | null>,
  ]);

  if (!clinic) {
    throw Object.assign(new Error("ClinicMissing"), { status: 500 });
  }
  if (campaign.templateId && !template) {
    throw Object.assign(new Error("TemplateMissing"), { status: 400 });
  }
  if (!inlineBody && !template) {
    throw Object.assign(new Error("TemplateRequired"), { status: 400 });
  }

  const channel = campaign.channel as CampaignChannel;
  const audienceRes = await resolveAudience({ segment, channel, now });
  // More reachable patients than one broadcast carries: refuse rather than
  // reach an arbitrary first slice while reporting it as everyone
  // (audit TG-10). The composer's preview shows the same limit.
  if (audienceRes.truncated) {
    throw Object.assign(new Error("AudienceTooLarge"), {
      status: 400,
      limit: audienceRes.limit,
      eligible: audienceRes.eligible,
    });
  }

  // Future-dated scheduling: rows carry the target time and we skip the
  // immediate enqueue below — the notifications scheduler dispatches QUEUED
  // rows once `scheduledFor <= now`. A past/absent time means "send now".
  const scheduledFor =
    campaign.scheduledFor && campaign.scheduledFor.getTime() > now.getTime()
      ? campaign.scheduledFor
      : now;
  const deferred = scheduledFor.getTime() > now.getTime();

  const rows = audienceRes.patients
    .map((patient) => {
      const recipient = recipientFor(channel, patient);
      if (!recipient) return null;
      const sourceBody =
        inlineBody ?? pickBodyTemplate(template as TemplateRow, patient.preferredLang);
      // The composer's preview renders through the same function (G6-21).
      const body = renderBroadcastBody(
        sourceBody,
        patient,
        clinic,
        patient.preferredLang,
      );
      return {
        clinicId: campaign.clinicId,
        campaignId: campaign.id,
        templateId: campaign.templateId,
        patientId: patient.id,
        channel: campaign.channel,
        recipient,
        body,
        scheduledFor,
        status: "QUEUED" as NotificationStatus,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    // Mark the campaign DONE-with-zero-sends so the user gets immediate feedback
    // and the row no longer shows up as DRAFT. Conditional, like the launch
    // below: a concurrent launch that already took the campaign keeps it.
    const flipped = await prisma.campaign.updateMany({
      where: { id: campaign.id, status: "DRAFT" },
      data: {
        status: "DONE",
        startedAt: now,
        finishedAt: now,
        totalCount: 0,
      },
    });
    return {
      campaignId: campaign.id,
      status: flipped.count === 1 ? "DONE" : "SENDING",
      totalCount: 0,
      alreadyLaunched: flipped.count !== 1,
      scheduledFor: null,
      deferred: false,
    };
  }

  // Single transaction: flip campaign, insert sends, optionally close action.
  const result = await prisma.$transaction(async (tx) => {
    // Concurrent-launch guard: one conditional UPDATE. Postgres row-locks the
    // campaign for the rest of this transaction; a second launch blocks on it,
    // re-reads the committed status (no longer DRAFT) and matches nothing, so
    // only the winner inserts sends.
    const claimed = await tx.campaign.updateMany({
      where: { id: campaign.id, status: "DRAFT" },
      data: { status: "SENDING", startedAt: now },
    });
    if (claimed.count !== 1) {
      return { totalCount: 0, alreadyLaunched: true as const };
    }

    await tx.notificationSend.createMany({
      data: rows as never,
    });

    const inserted = await tx.notificationSend.findMany({
      where: { campaignId: campaign.id, status: "QUEUED" },
      select: { id: true, scheduledFor: true },
    });

    await tx.campaign.update({
      where: { id: campaign.id },
      data: { totalCount: inserted.length },
    });

    if (args.sourceActionId) {
      const action = await tx.action.findUnique({
        where: { id: args.sourceActionId },
        select: { id: true, status: true },
      });
      if (action && action.status === "OPEN") {
        await tx.action.update({
          where: { id: action.id },
          data: { status: "DONE", doneAt: now },
        });
      }
    }

    return {
      totalCount: inserted.length,
      sends: inserted,
      alreadyLaunched: false as const,
    };
  });

  if (result.alreadyLaunched) {
    return {
      campaignId: campaign.id,
      status: "SENDING",
      totalCount: 0,
      alreadyLaunched: true,
      scheduledFor: campaign.scheduledFor,
      deferred: false,
    };
  }

  // Best-effort enqueue. The notifications scheduler picks QUEUED rows whose
  // scheduledFor has elapsed, so a missed enqueue here just delays delivery
  // until the next tick rather than dropping the send.
  //
  // For a deferred (future-dated) broadcast we deliberately skip the enqueue:
  // the worker does not re-check `scheduledFor`, so enqueuing now would fire
  // immediately. The scheduler is the only correct dispatch path for future rows.
  if (!deferred) {
    for (const send of result.sends ?? []) {
      try {
        // Same dedupe key the dispatch loop gives this attempt, so the
        // loop's next pass does not queue the row a second time.
        await enqueueDelivery(send, now);
      } catch (e) {
        console.warn(
          `[campaign:launch] enqueue failed for sendId=${send.id}`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return {
    campaignId: campaign.id,
    status: "SENDING",
    totalCount: result.totalCount,
    alreadyLaunched: false,
    scheduledFor: deferred ? scheduledFor : null,
    deferred,
  };
}

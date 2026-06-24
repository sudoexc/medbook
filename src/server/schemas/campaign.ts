/**
 * Zod schemas for the /api/crm/campaigns surface.
 *
 * Two families share the Campaign engine:
 *   - `dormant`  — reactivation campaigns driven by the DORMANT_BATCH Action
 *     Center detector. Always template-backed.
 *   - broadcast  — ad-hoc "рассылка" from the Telegram section: pick an
 *     audience (`all` / `segment` / `tag`), type an inline body, send now or
 *     schedule. The discriminated `segment` union keeps every kind on one
 *     payload shape so the launcher dispatches by `segment.kind`.
 */
import { z } from "zod";

export const DormantBucketEnum = z.enum(["90-180", "180-365", "365+"]);
export type DormantBucket = z.infer<typeof DormantBucketEnum>;

// Mirrors the Prisma `PatientSegment` enum.
export const PatientSegmentEnum = z.enum([
  "NEW",
  "ACTIVE",
  "DORMANT",
  "VIP",
  "CHURN",
]);
export type PatientSegment = z.infer<typeof PatientSegmentEnum>;

// "SMS" was dropped in Wave 3 of `docs/TZ-sms-removal.md`; campaigns
// are TG-only now. Legacy Campaign rows with channel="SMS" stay in
// the DB until the Wave 5 schema migration — the launcher refuses
// to send them (the Prisma `channel` column still permits the value).
export const CampaignChannelEnum = z.enum(["TG"]);
export type CampaignChannel = z.infer<typeof CampaignChannelEnum>;

export const DormantSegmentSchema = z.object({
  kind: z.literal("dormant"),
  bucket: DormantBucketEnum,
});

/** Every eligible patient (not deleted, marketing-consenting, reachable). */
export const AllSegmentSchema = z.object({
  kind: z.literal("all"),
});

/** One or more lifecycle categories (NEW / ACTIVE / DORMANT / VIP / CHURN). */
export const SegmentBySegmentSchema = z.object({
  kind: z.literal("segment"),
  segments: z.array(PatientSegmentEnum).min(1).max(5),
});

/** One or more free-form patient tags (OR-matched). */
export const TagSegmentSchema = z.object({
  kind: z.literal("tag"),
  tags: z.array(z.string().min(1).max(64)).min(1).max(20),
});

export const CampaignSegmentSchema = z.discriminatedUnion("kind", [
  DormantSegmentSchema,
  AllSegmentSchema,
  SegmentBySegmentSchema,
  TagSegmentSchema,
]);
export type CampaignSegment = z.infer<typeof CampaignSegmentSchema>;

/** Telegram hard-caps a single message at 4096 chars. */
export const BroadcastBodySchema = z.string().trim().min(1).max(4096);

export const CreateCampaignSchema = z.object({
  name: z.string().min(2).max(200),
  channel: CampaignChannelEnum,
  templateId: z.string().min(1).optional(),
  segment: CampaignSegmentSchema,
});
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;

/**
 * One-shot broadcast: create a DRAFT Campaign + launch it. `name` is optional
 * (server derives one from the audience + timestamp when omitted). `scheduledFor`
 * in the future defers delivery to the notifications scheduler.
 */
export const BroadcastSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  channel: CampaignChannelEnum.default("TG"),
  segment: CampaignSegmentSchema,
  body: BroadcastBodySchema,
  scheduledFor: z.coerce.date().optional(),
});
export type Broadcast = z.infer<typeof BroadcastSchema>;

/** Audience preview for the broadcast composer's live recipient count. */
export const PreviewAudienceSchema = z.object({
  channel: CampaignChannelEnum.default("TG"),
  segment: CampaignSegmentSchema,
});
export type PreviewAudience = z.infer<typeof PreviewAudienceSchema>;

export const LaunchCampaignSchema = z.object({
  /** Optional Action Center action id to close on successful launch. */
  sourceActionId: z.string().min(1).optional().nullable(),
});
export type LaunchCampaign = z.infer<typeof LaunchCampaignSchema>;

export const QueryCampaignsSchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

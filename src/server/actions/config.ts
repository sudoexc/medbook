/**
 * Action Center engine — clinic-tunable detector thresholds (Phase 13 Wave 2).
 *
 * Detectors are pure functions that read clinic data and emit `ActionPayload`s.
 * Every magic number lives here so a clinic can override the defaults
 * (Phase 19) without forking detector code. Wave 2 ships the defaults baked
 * in; per-clinic override is the next phase's concern.
 *
 * All thresholds are validated by tests and documented inline. Currency-related
 * thresholds are documented in tiins (UZS minor units, x100) where applicable.
 */

export type DetectorConfig = {
  /** Hour-of-day (0..23) when peak hours start in clinic local time. */
  emptySlotPeakHoursStart: number;
  /** Hour-of-day (0..23) when peak hours end (exclusive). */
  emptySlotPeakHoursEnd: number;
  /** A patient is "dormant" once this many days have elapsed since the last visit. */
  dormantMinDays: number;
  /** Minimum dormant patients in a single segment to fire DORMANT_BATCH. */
  dormantBatchMin: number;
  /** Skip DORMANT_BATCH if a campaign was sent to this segment within this many days. */
  dormantCampaignCooldownDays: number;
  /** Look-ahead window for unconfirmed booking actions, in hours. */
  unconfirmedHoursAhead: number;
  /** Risk threshold (0..1) above which NO_SHOW_RISK_HIGH fires. */
  noShowRiskThreshold: number;
  /** Look-ahead window for no-show risk, in hours. */
  noShowLookaheadHours: number;
  /** CASE_REPEAT_DUE fires when the deadline is at or within this many days. */
  caseRepeatLeadDays: number;
  /** OVERDUE_FOLLOW_UP fires when the visit completed at least this many days ago. */
  followUpStaleDays: number;
  /** Queue length above which a doctor is considered overloaded. */
  doctorOverloadQueueLength: number;
  /** Idle minutes after which a free cabinet is flagged. */
  idleRoomMinutes: number;
  /** PAYMENT_OVERDUE fires for unpaid completed appointments older than this many days. */
  paymentOverdueMinDays: number;
  /** LOW_DOCTOR_SCHEDULE fires when a doctor has fewer than this many slots in 7d. */
  lowScheduleSlotsThreshold: number;
};

export const DEFAULT_CONFIG: DetectorConfig = {
  emptySlotPeakHoursStart: 9,
  emptySlotPeakHoursEnd: 18,
  dormantMinDays: 90,
  dormantBatchMin: 20,
  dormantCampaignCooldownDays: 30,
  unconfirmedHoursAhead: 24,
  noShowRiskThreshold: 0.6,
  noShowLookaheadHours: 4,
  caseRepeatLeadDays: 7,
  followUpStaleDays: 7,
  doctorOverloadQueueLength: 8,
  idleRoomMinutes: 20,
  paymentOverdueMinDays: 0,
  lowScheduleSlotsThreshold: 5,
};

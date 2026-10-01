/**
 * Wire types for the /crm/analytics/loss dashboard. Mirrors the response
 * shape returned by `src/server/revenue/loss-data.ts` via the
 * `/api/crm/analytics/loss` route handler.
 */

export type LossPeriod = "week" | "month" | "quarter";

export interface LossTotalsWire {
  emptySlot: number;
  noShow: number;
  cancellation: number;
  total: number;
}

export interface DailyLossPointWire {
  date: string;
  emptySlot: number;
  noShow: number;
  cancellation: number;
}

export interface LossDoctorRowWire {
  doctorId: string;
  nameRu: string;
  nameUz: string;
  emptySlotUzs: number;
  noShowUzs: number;
  cancellationUzs: number;
  totalUzs: number;
}

export interface LossSegmentRowWire {
  segment: "recent_lapse" | "mid_lapse" | "deep_lapse";
  patientCount: number;
  /** Null when there is no honest value per patient (no payments recorded). */
  estimatedRevenueUzs: number | null;
}

/** The dormant base now: a stock beside the period, not part of its total. */
export interface DormantStockWire {
  patientCount: number;
  segments: LossSegmentRowWire[];
  estimatedRevenueUzs: number | null;
}

export interface LossDashboardResponse {
  period: string;
  from: string;
  to: string;
  fromKey: string;
  toKeyExcl: string;
  totals: LossTotalsWire;
  daily: DailyLossPointWire[];
  topDoctors: LossDoctorRowWire[];
  dormant: DormantStockWire;
  hasAnyData: boolean;
  averageVisitValueUzs: number | null;
}

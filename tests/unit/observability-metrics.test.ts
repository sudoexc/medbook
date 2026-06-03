/**
 * Phase M7 — Prometheus text exposition smoke test.
 *
 * We don't depend on `prom-client`, so the format has to be sanity-checked
 * here. Verifies: HELP/TYPE headers, label encoding, histogram cumulative
 * buckets + +Inf / sum / count, gauge inc/dec, empty-state zero lines.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMetricsForTests,
  getMetrics,
  renderMetrics,
} from "@/server/observability/metrics";

describe("observability/metrics", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("renders zero-lines for unused counters and histograms", () => {
    const out = renderMetrics();
    expect(out).toContain(
      "# HELP miniapp_sse_events_delivered_total Mini-app SSE envelopes delivered to clients.",
    );
    expect(out).toContain("# TYPE miniapp_sse_events_delivered_total counter");
    expect(out).toContain("miniapp_sse_events_delivered_total 0");
    expect(out).toContain('miniapp_booking_duration_seconds_bucket{le="0.05"} 0');
    expect(out).toContain('miniapp_booking_duration_seconds_bucket{le="+Inf"} 0');
    expect(out).toContain("miniapp_booking_duration_seconds_sum 0");
    expect(out).toContain("miniapp_booking_duration_seconds_count 0");
  });

  it("accumulates counter increments with labels", () => {
    const m = getMetrics();
    m.sseEventsDelivered.inc({ event_type: "appointment.created", clinic_id: "c1" });
    m.sseEventsDelivered.inc({ event_type: "appointment.created", clinic_id: "c1" });
    m.sseEventsDelivered.inc({ event_type: "previsit.submitted", clinic_id: "c1" });

    const out = renderMetrics();
    expect(out).toContain(
      'miniapp_sse_events_delivered_total{clinic_id="c1",event_type="appointment.created"} 2',
    );
    expect(out).toContain(
      'miniapp_sse_events_delivered_total{clinic_id="c1",event_type="previsit.submitted"} 1',
    );
  });

  it("supports gauge inc/dec for SSE connections", () => {
    const m = getMetrics();
    m.sseConnectionsActive.inc({ clinic_id: "c1" });
    m.sseConnectionsActive.inc({ clinic_id: "c1" });
    m.sseConnectionsActive.dec({ clinic_id: "c1" });

    const out = renderMetrics();
    expect(out).toContain('miniapp_sse_connections_active{clinic_id="c1"} 1');
  });

  it("builds cumulative histogram buckets + sum + count", () => {
    const m = getMetrics();
    m.bookingDuration.observe(0.2, { outcome: "success" });
    m.bookingDuration.observe(0.4, { outcome: "success" });
    m.bookingDuration.observe(3.0, { outcome: "success" });

    const out = renderMetrics();
    // 0.2 + 0.4 land in the 0.25 / 0.5 buckets; 3.0 lands above 2.5 but ≤ 5.
    expect(out).toContain(
      'miniapp_booking_duration_seconds_bucket{outcome="success",le="0.25"} 1',
    );
    expect(out).toContain(
      'miniapp_booking_duration_seconds_bucket{outcome="success",le="0.5"} 2',
    );
    expect(out).toContain(
      'miniapp_booking_duration_seconds_bucket{outcome="success",le="5"} 3',
    );
    expect(out).toContain(
      'miniapp_booking_duration_seconds_bucket{outcome="success",le="+Inf"} 3',
    );
    expect(out).toContain(
      'miniapp_booking_duration_seconds_count{outcome="success"} 3',
    );
    // sum: 0.2 + 0.4 + 3.0 = 3.6
    expect(out).toMatch(
      /miniapp_booking_duration_seconds_sum\{outcome="success"\} 3\.6\b/,
    );
  });

  it("escapes label values that contain quotes / backslashes / newlines", () => {
    const m = getMetrics();
    m.clientErrors.inc({ clinic_id: 'evil"\\\n' });

    const out = renderMetrics();
    expect(out).toContain(
      'miniapp_client_errors_total{clinic_id="evil\\"\\\\\\n"} 1',
    );
  });
});

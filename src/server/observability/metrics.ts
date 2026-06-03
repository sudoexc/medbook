/**
 * In-process Prometheus metrics registry — text exposition format.
 *
 * Minimal counter / gauge / histogram with label support. No external dep —
 * the format spec at https://prometheus.io/docs/instrumenting/exposition_formats/
 * is a few dozen lines, and this codebase only needs ~7 metric series.
 *
 * Numbers reset on process restart (that's fine — Prom interprets a counter
 * reset as a step down, and scrapes are wall-clock seconds apart). The
 * histogram uses fixed buckets tuned for sub-10s booking latency; tweak
 * BOOKING_BUCKETS_SECONDS if real-world p99 walks outside the range.
 */

type Labels = Record<string, string | number>;

function encodeLabel(value: string | number): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}="${encodeLabel(v)}"`).join(",");
}

function renderLabels(key: string): string {
  return key ? `{${key}}` : "";
}

abstract class Metric {
  readonly name: string;
  readonly help: string;
  readonly type: "counter" | "gauge" | "histogram";

  constructor(name: string, help: string, type: "counter" | "gauge" | "histogram") {
    this.name = name;
    this.help = help;
    this.type = type;
  }

  abstract render(): string;

  protected header(): string {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
  }
}

class Counter extends Metric {
  private values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, "counter");
  }

  inc(labels?: Labels, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }

  render(): string {
    if (this.values.size === 0) {
      // Always export at least one zero-line so Prom can resolve the series
      // before the first event — saves the operator dashboard a no-data state.
      return `${this.header()}${this.name} 0\n`;
    }
    let out = this.header();
    for (const [k, v] of this.values) {
      out += `${this.name}${renderLabels(k)} ${v}\n`;
    }
    return out;
  }
}

class Gauge extends Metric {
  private values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }

  set(value: number, labels?: Labels): void {
    this.values.set(labelKey(labels), value);
  }

  inc(labels?: Labels, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }

  dec(labels?: Labels, by = 1): void {
    this.inc(labels, -by);
  }

  render(): string {
    if (this.values.size === 0) return `${this.header()}${this.name} 0\n`;
    let out = this.header();
    for (const [k, v] of this.values) {
      out += `${this.name}${renderLabels(k)} ${v}\n`;
    }
    return out;
  }
}

class Histogram extends Metric {
  readonly buckets: number[];
  private series = new Map<
    string,
    { counts: number[]; sum: number; count: number }
  >();

  constructor(name: string, help: string, buckets: number[]) {
    super(name, help, "histogram");
    // Prom requires bucket boundaries in ascending order. We append +Inf
    // ourselves in render().
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels?: Labels): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: new Array<number>(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) s.counts[i]! += 1;
    }
    s.sum += value;
    s.count += 1;
  }

  render(): string {
    if (this.series.size === 0) {
      let out = this.header();
      for (const b of this.buckets) {
        out += `${this.name}_bucket{le="${b}"} 0\n`;
      }
      out += `${this.name}_bucket{le="+Inf"} 0\n`;
      out += `${this.name}_sum 0\n`;
      out += `${this.name}_count 0\n`;
      return out;
    }
    let out = this.header();
    for (const [k, s] of this.series) {
      const labelPrefix = k ? `${k},` : "";
      for (let i = 0; i < this.buckets.length; i++) {
        out += `${this.name}_bucket{${labelPrefix}le="${this.buckets[i]}"} ${s.counts[i]}\n`;
      }
      out += `${this.name}_bucket{${labelPrefix}le="+Inf"} ${s.count}\n`;
      out += `${this.name}_sum${renderLabels(k)} ${s.sum}\n`;
      out += `${this.name}_count${renderLabels(k)} ${s.count}\n`;
    }
    return out;
  }
}

class Registry {
  private metrics: Metric[] = [];

  register<T extends Metric>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }

  render(): string {
    return this.metrics.map((m) => m.render()).join("\n");
  }

  reset(): void {
    this.metrics = [];
  }
}

// Singleton — survives across hot-reloads in dev by pinning to globalThis.
type GlobalWithMetrics = typeof globalThis & {
  __miniapp_metrics_registry?: Registry;
  __miniapp_metrics?: ReturnType<typeof buildMetrics>;
};

function buildMetrics(reg: Registry) {
  const sseConnectionsActive = reg.register(
    new Gauge(
      "miniapp_sse_connections_active",
      "Current count of open mini-app SSE streams (per clinic).",
    ),
  );
  const sseEventsDelivered = reg.register(
    new Counter(
      "miniapp_sse_events_delivered_total",
      "Mini-app SSE envelopes delivered to clients.",
    ),
  );
  const sseReplayEvents = reg.register(
    new Counter(
      "miniapp_sse_replay_events_total",
      "Mini-app SSE envelopes replayed on reconnect via Last-Event-ID / ?since=.",
    ),
  );
  const outboxPublishes = reg.register(
    new Counter(
      "miniapp_outbox_publishes_total",
      "Outbox envelopes published, partitioned by event type and surface.",
    ),
  );
  // Sub-10s histogram: any booking that crosses the right edge already needs
  // investigation, so we let it land in +Inf. Granular sub-second buckets
  // help us tell apart "fast on cache hit" from "slow on cold path".
  const bookingDuration = reg.register(
    new Histogram(
      "miniapp_booking_duration_seconds",
      "End-to-end latency of POST /api/miniapp/appointments.",
      [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    ),
  );
  const bookingIdempotencyHits = reg.register(
    new Counter(
      "miniapp_booking_idempotency_hits_total",
      "Booking POST requests served from the Idempotency-Key cache.",
    ),
  );
  const clientErrors = reg.register(
    new Counter(
      "miniapp_client_errors_total",
      "Mini-app client errors reported via /api/miniapp/client-errors.",
    ),
  );

  return {
    sseConnectionsActive,
    sseEventsDelivered,
    sseReplayEvents,
    outboxPublishes,
    bookingDuration,
    bookingIdempotencyHits,
    clientErrors,
  };
}

function ensureSingleton(): {
  registry: Registry;
  metrics: ReturnType<typeof buildMetrics>;
} {
  const g = globalThis as GlobalWithMetrics;
  if (!g.__miniapp_metrics_registry) {
    g.__miniapp_metrics_registry = new Registry();
    g.__miniapp_metrics = buildMetrics(g.__miniapp_metrics_registry);
  }
  return { registry: g.__miniapp_metrics_registry, metrics: g.__miniapp_metrics! };
}

export function getMetrics(): ReturnType<typeof buildMetrics> {
  return ensureSingleton().metrics;
}

export function renderMetrics(): string {
  return ensureSingleton().registry.render();
}

export function __resetMetricsForTests(): void {
  const g = globalThis as GlobalWithMetrics;
  g.__miniapp_metrics_registry = new Registry();
  g.__miniapp_metrics = buildMetrics(g.__miniapp_metrics_registry);
}

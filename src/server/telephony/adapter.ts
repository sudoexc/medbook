/**
 * TelephonyAdapter — abstraction over any IP-telephony provider.
 *
 * Neurofax runs on a generic `TelephonyAdapter`. Real providers
 * (OnlinePBX / Mango / UIS / Asterisk ARI) are wired behind this interface.
 * The default implementation is `LogOnlyTelephonyAdapter` (see `log-only.ts`)
 * which persists `Call` rows + emits the same event-bus events as a real
 * provider would — the UI and the webhook path are fully testable without
 * any external service.
 *
 * Contract (see TZ §6.7.5):
 *   - `call(to, from)` — initiates an outbound leg. Returns a provider-issued
 *     callId. LogOnly fabricates `log-<nanoid>`.
 *   - `hangup(callId)` — tears down the leg, marks the Call row ENDED,
 *     computes durationSec from timestamps.
 *   - `onEvent(cb)` — subscribes to inbound lifecycle events. LogOnly
 *     forwards the process-local event bus; real providers wire their webhook
 *     handler into the same bus so the subscription is adapter-agnostic.
 */

export type TelephonyEventKind =
  | "ringing"
  | "answered"
  | "hangup"
  | "missed";

export interface TelephonyEvent {
  kind: TelephonyEventKind;
  /** Provider-issued call identifier (for LogOnly: `log-<nanoid>`). */
  callId: string;
  /** E.164-ish caller number. */
  from: string;
  /** E.164-ish callee number (usually the clinic trunk on inbound). */
  to: string;
  /** When the provider observed the event. */
  timestamp: Date;
  /** Optional provider-specific fields (DID, trunk, recording URL, etc.). */
  meta?: Record<string, unknown>;
}

export interface TelephonyAdapter {
  /** Human-readable adapter name for diagnostics ("log-only", "onlinepbx", …). */
  readonly name: string;

  /** Initiate an outbound call. */
  call(to: string, from: string): Promise<{ callId: string }>;

  /** Tear down an existing call by provider id. */
  hangup(callId: string): Promise<void>;

  /**
   * Subscribe to inbound lifecycle events. Returns an unsubscribe function.
   * Events may arrive out of order; consumers must be idempotent on callId.
   */
  onEvent(cb: (e: TelephonyEvent) => void): () => void;
}

/** Channels the event bus publishes for telephony (see realtime/event-bus.ts). */
export const TELEPHONY_CHANNELS = {
  ringing: "telephony.ringing",
  answered: "telephony.answered",
  hangup: "telephony.hangup",
  missed: "telephony.missed",
} as const;

/** Channels consumers (reception widget / call center) listen on. */
export const CALL_CHANNELS = {
  incoming: "call.incoming",
  answered: "call.answered",
  ended: "call.ended",
} as const;

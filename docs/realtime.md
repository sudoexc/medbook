# Realtime layer — `/api/events` + typed event bus

This note is the operator's manual for the realtime transport introduced
in Phase 5. See TZ §4.6 and §8.8 for the product-level requirements.

## Architecture

```
   ┌─ mutation handler / worker / webhook ─┐
   │   publishEvent(clinicId, {type,...})   │
   └──────────────┬────────────────────────┘
                  │ Zod validate
                  ▼
       ┌────────────────────────┐        ┌──────────────────────┐
       │   in-process EventBus   │        │   Redis (optional)   │
       │   channel clinic:<id>:  │───────▶│   events:<clinicId>  │
       │   events                │ PUBLISH└──────────────────────┘
       └─────────┬──────────────┘                   │
                 │                                  │ pSubscribe
                 ▼                                  │
   ┌────────────────────────────────────────────────┘
   │  `/api/events` handler reads from local bus
   │  emits `data: <json>\n\n` frames to EventSource
   └────┬───────────────────────────────────────────
        ▼
   browser `EventSource` → `useLiveEvents` (singleton, ref-counted)
        │
        ▼
   `useLiveQueryInvalidation` → TanStack Query `invalidateQueries`
```

* **Single-node dev:** `REDIS_URL` unset. Every publish stays in the
  process' `EventBus`. `/api/events` subscribes to the same bus, so the
  browser always receives the event.
* **Horizontal prod:** set `REDIS_URL`. `publishEvent` mirrors the
  envelope to `events:<clinicId>`; each node's `ensureRedisSubscriber`
  forwards inbound Redis messages to the local bus so SSE consumers on
  that node hear them.

## Envelope

```ts
type AppEvent = {
  type: EventType,             // discriminator
  clinicId: string,            // REQUIRED; tenant scope
  at: string,                  // ISO-8601 with offset (filled by publisher)
  payload: { ... }             // per-type shape, Zod-checked
}
```

Full registry in `src/server/realtime/events.ts`. `EVENT_TYPES` is the
exhaustive list; `AppEvent` is the discriminated union; `EventOf<T>`
narrows to a single variant.

### Current event types

| Type | Purpose |
|---|---|
| `appointment.created` | new appointment row |
| `appointment.updated` | any field change except status/time |
| `appointment.statusChanged` | status transition (BOOKED → IN_PROGRESS, etc.) |
| `appointment.cancelled` | status moved to CANCELLED |
| `appointment.moved` | date/time/doctor/cabinet reshuffle |
| `queue.updated` | queueStatus changed; reception widget redraws |
| `call.incoming` | SIP provider reported a ringing call |
| `call.answered` | operator picked up |
| `call.ended` | hangup |
| `call.missed` | no answer |
| `tg.message.new` | new Telegram message (IN or OUT) |
| `tg.takeover.incoming` | operator takeover needed |
| `tg.conversation.updated` | conversation meta changed |
| `payment.paid` | payment status transitioned to PAID |
| `payment.due` | reminder threshold hit |
| `notification.sent` | worker delivered a notification |
| `notification.failed` | final delivery failure |
| `cabinet.occupancy.changed` | cabinet free/taken |

## Adding a new event type

1. Add a Zod payload schema in `src/server/realtime/events.ts`:

   ```ts
   export const MyThingPayload = z.object({
     thingId: z.string(),
     reason: z.string().optional(),
   }).passthrough();
   ```

2. Add the literal to `EVENT_TYPES` and the union via `makeEvent(...)`:

   ```ts
   export const EVENT_TYPES = [
     ...
     "mything.happened",
   ] as const;

   export const AppEventSchema = z.discriminatedUnion("type", [
     ...
     makeEvent("mything.happened", MyThingPayload),
   ]);
   ```

3. Publish from the mutation handler:

   ```ts
   import { publishEventSafe } from "@/server/realtime/publish";
   publishEventSafe(clinicId, {
     type: "mything.happened",
     payload: { thingId: row.id },
   });
   ```

4. Invalidate on the client:

   ```ts
   import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
   useLiveQueryInvalidation({
     events: ["mything.happened"],
     queryKey: ["my", "thing"],
   });
   ```

5. Add a unit test in `tests/unit/realtime-events.test.ts` covering a
   positive + negative payload case.

## Client hooks

* **`useLiveEvents(handler, { filter?, enabled? })`** — low-level
  subscription. All consumers share a single `EventSource` (ref-counted).
  SSR-safe (no-ops on the server + in vitest).
* **`useLiveQueryInvalidation({ events, queryKey?, queryKeys?, ...})`** —
  subscribe and call `queryClient.invalidateQueries` for one/many keys.
  Supports a callback form for per-event dynamic keys.

Polling intervals elsewhere in the codebase were relaxed to **60 s** as a
fallback: if the socket is dropped and the reconnect fails, we still
eventually catch up.

## Redis deployment note

Redis pub/sub is **at-most-once**. Events published while a subscriber is
disconnected are lost — the Zod envelope does not carry a sequence id. The
60-second polling fallback exists for exactly this case. When BullMQ +
Redis lands in Phase 6:

1. Set `REDIS_URL` in the deployment env. The rest is automatic.
2. `/api/events` keeps working unchanged. The first request per node
   calls `ensureRedisSubscriber` once; it psubscribes to `events:*` and
   forwards messages to the local bus.
3. For tests, leave `REDIS_URL` unset. The suite uses the in-memory bus
   exclusively; no network, no flakiness.

## Why not WebSockets?

* SSE is push-only from server to client, which is exactly our use case.
* `EventSource` has built-in reconnect semantics the browser manages.
* It traverses corporate proxies with `Content-Type: text/event-stream`
  more reliably than WebSocket upgrades (§4.6 §8.8 prefer this too).
* Next.js 16 supports streaming `Response(ReadableStream)` natively.

## Debugging

* Tail `/api/events` with `curl -N --cookie "next-auth.session-token=..."
  http://localhost:3000/api/events` to watch raw frames.
* In the browser DevTools Network tab, SSE streams show up under type
  `eventsource` — expand to see individual messages.
* `getEventBus().size(clinicChannel(clinicId))` returns the number of
  local subscribers (useful for in-process diagnostics).
* Set `DEBUG=sse` in the env to enable extra logging once Phase 6 adds a
  structured logger.

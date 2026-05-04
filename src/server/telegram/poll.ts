/**
 * Telegram long-poll worker.
 *
 * The RU VPS we run on cannot reliably receive webhooks from Telegram —
 * Telegram's edge cannot establish TCP from Amsterdam/Miami → 5.x.x.x. So
 * we poll instead: our process initiates the call to api.telegram.org and
 * pulls pending updates. The outgoing direction is also rate-limited (~30%
 * of TG IPs answer per DNS pick), but `bot-api.ts` already retries 12× per
 * call, so over a couple of long-poll rounds we drain the queue.
 *
 * Each polled update is forwarded to the existing webhook handler over the
 * internal docker network (`http://app:3000/api/telegram/webhook/<slug>`).
 * That keeps a single source of truth for FSM dispatch + Conversation
 * upsert + SSE fan-out — no logic duplication.
 *
 * On startup we call `deleteWebhook` once so Telegram stops trying (and
 * fail-allows) `getUpdates`.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { deleteWebhook, getUpdates, type TgUpdate } from "./bot-api";

const INTERNAL_APP_URL =
  process.env.INTERNAL_APP_URL?.replace(/\/+$/, "") ?? "http://app:3000";
const ERROR_BACKOFF_MS = 5_000;
const LONG_POLL_TIMEOUT_S = 25;

type PollClinic = {
  id: string;
  slug: string;
  tgBotToken: string;
  tgWebhookSecret: string;
};

async function loadPollableClinics(): Promise<PollClinic[]> {
  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findMany({
      where: {
        tgBotToken: { not: null },
        tgWebhookSecret: { not: null },
      },
      select: {
        id: true,
        slug: true,
        tgBotToken: true,
        tgWebhookSecret: true,
      },
    }),
  );
  return rows.flatMap((r) =>
    r.tgBotToken && r.tgWebhookSecret
      ? [
          {
            id: r.id,
            slug: r.slug,
            tgBotToken: r.tgBotToken,
            tgWebhookSecret: r.tgWebhookSecret,
          },
        ]
      : [],
  );
}

async function forwardUpdateToWebhook(
  clinic: PollClinic,
  update: TgUpdate,
): Promise<void> {
  const url = `${INTERNAL_APP_URL}/api/telegram/webhook/${clinic.slug}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": clinic.tgWebhookSecret,
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`webhook returned ${res.status}`);
  }
}

async function pollLoop(clinic: PollClinic): Promise<void> {
  console.info(`[tg:poll ${clinic.slug}] starting`);

  // Drop webhook so getUpdates is allowed. Idempotent — TG returns ok if
  // there was no webhook.
  try {
    await deleteWebhook(clinic.tgBotToken, false);
    console.info(`[tg:poll ${clinic.slug}] webhook cleared`);
  } catch (e) {
    console.warn(
      `[tg:poll ${clinic.slug}] deleteWebhook failed (continuing): ${(e as Error).message}`,
    );
  }

  let offset: number | undefined = undefined;
  for (;;) {
    try {
      const resp = await getUpdates(clinic.tgBotToken, {
        offset,
        timeoutSec: LONG_POLL_TIMEOUT_S,
        allowedUpdates: ["message", "callback_query", "my_chat_member"],
      });
      if (!resp.ok) {
        // 409 Conflict = webhook is set elsewhere; admin re-set it after
        // we cleared. Try to drop it again next iteration.
        console.warn(
          `[tg:poll ${clinic.slug}] getUpdates ${resp.error_code}: ${resp.description}`,
        );
        if (resp.error_code === 409) {
          try {
            await deleteWebhook(clinic.tgBotToken, false);
          } catch {
            // best-effort
          }
        }
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }
      const updates = resp.result;
      if (updates.length === 0) continue;

      // Forward each update sequentially. The webhook handler does the FSM
      // step + sendMessage; sendMessage may take up to ~96s on this VPS,
      // but updates from different chats can interleave fine, so we fire
      // them in parallel and wait on the batch.
      await Promise.allSettled(
        updates.map((u) =>
          forwardUpdateToWebhook(clinic, u).catch((e) => {
            console.error(
              `[tg:poll ${clinic.slug}] forward update_id=${u.update_id} failed: ${(e as Error).message}`,
            );
          }),
        ),
      );

      // Advance offset past the highest update_id we saw, regardless of
      // whether forwarding succeeded — Telegram will not redeliver, and
      // re-polling the same range would just retry forever.
      const maxId = updates.reduce((m, u) => (u.update_id > m ? u.update_id : m), 0);
      offset = maxId + 1;
    } catch (e) {
      console.error(
        `[tg:poll ${clinic.slug}] iteration error: ${(e as Error).message}`,
      );
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start polling loops for every TG-configured clinic. Returns immediately;
 * each loop runs in the background. Process stays alive because the loops
 * await network I/O continuously.
 */
export async function startTgPollingWorkers(): Promise<void> {
  const clinics = await loadPollableClinics();
  if (clinics.length === 0) {
    console.info("[tg:poll] no clinics with tgBotToken — polling not started");
    return;
  }
  for (const c of clinics) {
    void pollLoop(c);
  }
  console.info(
    `[tg:poll] started ${clinics.length} polling loop(s): ${clinics.map((c) => c.slug).join(", ")}`,
  );
}

/**
 * Local-dev Telegram polling bridge.
 *
 * Why this exists: in local development we don't have a public HTTPS origin,
 * so we can't use Telegram webhooks. Instead, this script long-polls
 * `getUpdates` for every clinic that has `tgBotToken` set, then forwards each
 * update to our own `/api/telegram/webhook/[clinicSlug]` route — exactly the
 * same payload the webhook would receive in production.
 *
 * Run via: `npm run tg:poll`
 *
 * Env:
 *   TG_POLL_TARGET   override forwarding base URL (default: http://localhost:3000)
 *   TG_POLL_TIMEOUT  long-poll timeout seconds (default: 25)
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

type TgUpdate = { update_id: number; [k: string]: unknown };
type GetUpdatesResp = {
  ok: boolean;
  result?: TgUpdate[];
  description?: string;
  error_code?: number;
};

type ClinicBot = {
  id: string;
  slug: string;
  nameRu: string;
  tgBotToken: string;
  tgBotUsername: string | null;
  tgWebhookSecret: string | null;
};

const TARGET = process.env.TG_POLL_TARGET ?? "http://localhost:3000";
const POLL_TIMEOUT = Math.max(0, Number(process.env.TG_POLL_TIMEOUT ?? 25));

const lastUpdateId = new Map<string, number>();
let stopping = false;

async function loadClinicBots(): Promise<ClinicBot[]> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const rows = await prisma.clinic.findMany({
      where: { tgBotToken: { not: null } },
      select: {
        id: true,
        slug: true,
        nameRu: true,
        tgBotToken: true,
        tgBotUsername: true,
        tgWebhookSecret: true,
      },
    });
    return rows.filter((r): r is ClinicBot => Boolean(r.tgBotToken));
  });
}

async function deleteWebhook(token: string): Promise<void> {
  // getUpdates and webhook are mutually exclusive — clear any prior webhook
  // so Telegram doesn't reject our long-poll with 409 Conflict.
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`,
    );
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { description?: string } | null;
      console.warn(
        `  [warn] deleteWebhook failed (${r.status}): ${j?.description ?? "unknown"}`,
      );
    }
  } catch (e) {
    console.warn(`  [warn] deleteWebhook network error: ${(e as Error).message}`);
  }
}

async function pollOnce(bot: ClinicBot): Promise<void> {
  const offset = (lastUpdateId.get(bot.id) ?? 0) + 1;
  const url = new URL(`https://api.telegram.org/bot${bot.tgBotToken}/getUpdates`);
  if (offset > 1) url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", String(POLL_TIMEOUT));

  let resp: Response;
  try {
    resp = await fetch(url, { method: "GET" });
  } catch (e) {
    console.warn(`[${bot.slug}] network error: ${(e as Error).message}`);
    await sleep(2000);
    return;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn(`[${bot.slug}] getUpdates HTTP ${resp.status}: ${text.slice(0, 200)}`);
    if (resp.status === 401) {
      // Token revoked — stop polling this bot for the rest of the session.
      console.warn(`[${bot.slug}] token rejected by Telegram, dropping bot`);
      bot.tgBotToken = "";
    }
    await sleep(2000);
    return;
  }

  const json = (await resp.json()) as GetUpdatesResp;
  if (!json.ok || !Array.isArray(json.result)) {
    console.warn(`[${bot.slug}] getUpdates not ok: ${json.description ?? "?"}`);
    await sleep(2000);
    return;
  }

  for (const update of json.result) {
    lastUpdateId.set(bot.id, update.update_id);
    await forwardUpdate(bot, update);
  }
}

async function forwardUpdate(bot: ClinicBot, update: TgUpdate): Promise<void> {
  if (!bot.tgWebhookSecret) {
    console.warn(`[${bot.slug}] no tgWebhookSecret — skipping update ${update.update_id}`);
    return;
  }
  const targetUrl = `${TARGET}/api/telegram/webhook/${bot.slug}`;
  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": bot.tgWebhookSecret,
      },
      body: JSON.stringify(update),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.warn(
        `[${bot.slug}] forward HTTP ${r.status}: ${text.slice(0, 200)}`,
      );
    } else {
      const summary = summarizeUpdate(update);
      console.log(`[${bot.slug}] ✓ ${summary}`);
    }
  } catch (e) {
    console.warn(`[${bot.slug}] forward error: ${(e as Error).message}`);
  }
}

function summarizeUpdate(u: TgUpdate): string {
  const id = u.update_id;
  const m = (u as { message?: { text?: string; chat?: { id?: number } } }).message;
  if (m) {
    const text = m.text ? `"${m.text.slice(0, 60)}"` : "(non-text)";
    return `update=${id} chat=${m.chat?.id ?? "?"} ${text}`;
  }
  const cb = (u as { callback_query?: { data?: string } }).callback_query;
  if (cb) return `update=${id} callback=${cb.data ?? ""}`;
  return `update=${id} (other)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollLoop(bot: ClinicBot): Promise<void> {
  while (!stopping && bot.tgBotToken) {
    await pollOnce(bot);
  }
}

async function main(): Promise<void> {
  console.log(`tg-poll: forwarding to ${TARGET}, long-poll timeout ${POLL_TIMEOUT}s\n`);

  const bots = await loadClinicBots();
  if (bots.length === 0) {
    console.log("No clinics with tgBotToken configured — nothing to poll.");
    console.log("Connect a bot via /crm/settings/integrations first.");
    return;
  }

  for (const b of bots) {
    console.log(
      `· ${b.slug} (${b.nameRu}) → bot @${b.tgBotUsername ?? "?"} ` +
        `[secret ${b.tgWebhookSecret ? "set" : "MISSING"}]`,
    );
    await deleteWebhook(b.tgBotToken);
  }
  console.log("");

  process.on("SIGINT", () => {
    console.log("\nstopping…");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  await Promise.all(bots.map((b) => pollLoop(b)));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

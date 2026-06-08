/**
 * Adapter factory: picks a TG / InApp adapter for a clinic based on the
 * active `ProviderConnection` rows + the clinic's bot token. Falls back to
 * log-only when no provider is configured (dev / clinics without TG setup).
 *
 * SMS was removed in Wave 3 of the SMS-removal plan (see
 * `docs/TZ-sms-removal.md`); the SMS adapter family is gone.
 *
 * Keep the factory pure (no DB calls inside `pick*`) — DB lookup happens in
 * `resolveAdapters(clinicId)` which the worker calls once per job.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import type { InAppAdapter } from "./inapp";
import { LocalInAppAdapter } from "./inapp";
import type { TgAdapter } from "./tg";
import { LogOnlyTgAdapter } from "./tg-log-only";
import { TelegramClinicAdapter } from "./tg-clinic";

export type AdapterPair = {
  tg: TgAdapter;
  inapp: InAppAdapter;
  /** True if at least one real provider was picked. */
  real: { tg: boolean; inapp: boolean };
};

function pickTg(
  clinicId: string,
  providerLabel: string | null,
  _cfg: Record<string, unknown> | null,
  hasBotToken: boolean,
): TgAdapter {
  // Phase 3b: real Telegram adapter is available. Selection rules:
  //   1. Explicit ProviderConnection with label="telegram" and a bot token
  //      configured on the Clinic row → real adapter.
  //   2. No ProviderConnection but a bot token is set → real adapter (lets
  //      a clinic onboard with just the token, no extra config).
  //   3. Otherwise → log-only (dev / clinics without TG setup).
  if (providerLabel === "telegram" && hasBotToken) {
    return new TelegramClinicAdapter(clinicId);
  }
  if (hasBotToken) {
    return new TelegramClinicAdapter(clinicId);
  }
  return new LogOnlyTgAdapter();
}

/**
 * Load per-clinic `ProviderConnection` rows and build adapters.
 *
 * Provider lookups cross tenant boundaries (workers run under SYSTEM
 * context), so we pin to the given clinic explicitly via runWithTenant.
 */
export async function resolveAdapters(clinicId: string): Promise<AdapterPair> {
  const { rows, hasBotToken } = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const [rows, clinic] = await Promise.all([
      prisma.providerConnection.findMany({
        where: { clinicId, active: true, kind: "TELEGRAM" },
        select: { kind: true, label: true, config: true },
      }),
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { tgBotToken: true },
      }),
    ]);
    return { rows, hasBotToken: Boolean(clinic?.tgBotToken) };
  });

  let tgLabel: string | null = null;
  let tgCfg: Record<string, unknown> | null = null;
  for (const r of rows) {
    if (r.kind === "TELEGRAM") {
      tgLabel = r.label ?? null;
      tgCfg = (r.config as Record<string, unknown> | null) ?? null;
    }
  }

  const tg = pickTg(clinicId, tgLabel, tgCfg, hasBotToken);
  const inapp: InAppAdapter = new LocalInAppAdapter();
  return {
    tg,
    inapp,
    real: {
      tg: tg.name !== "log-only",
      inapp: true,
    },
  };
}

export {
  LogOnlyTgAdapter,
  TelegramClinicAdapter,
  LocalInAppAdapter,
};
export type { TgAdapter, InAppAdapter };

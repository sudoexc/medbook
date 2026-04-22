/**
 * Adapter factory: picks an SMS/TG adapter for a clinic based on active
 * `ProviderConnection` rows. Falls back to log-only when no provider is
 * configured — that's the default in dev/test and during Phase 3a.
 *
 * Keep the factory pure (no DB calls inside `pick*`) — DB lookup happens
 * in `resolveAdapters(clinicId)` which the worker calls once per job.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import type { SmsAdapter } from "./sms";
import { LogOnlySmsAdapter } from "./sms-log-only";
import { EskizSmsAdapter, type EskizConfig } from "./sms-eskiz-stub";
import type { TgAdapter } from "./tg";
import { LogOnlyTgAdapter } from "./tg-log-only";
import { TelegramClinicAdapter } from "./tg-clinic";

export type AdapterPair = {
  sms: SmsAdapter;
  tg: TgAdapter;
  /** True if at least one real provider was picked. */
  real: { sms: boolean; tg: boolean };
};

function pickSms(
  providerLabel: string | null,
  cfg: Record<string, unknown> | null,
): SmsAdapter {
  if (providerLabel === "eskiz" && cfg && typeof cfg === "object") {
    // Real config is decrypted by the caller — Phase 4 wires the decrypt
    // flow. For now the stub just throws; worker turns that into FAILED.
    return new EskizSmsAdapter(cfg as unknown as EskizConfig);
  }
  return new LogOnlySmsAdapter();
}

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
        where: { clinicId, active: true, kind: { in: ["SMS", "TELEGRAM"] } },
        select: { kind: true, label: true, config: true },
      }),
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { tgBotToken: true },
      }),
    ]);
    return { rows, hasBotToken: Boolean(clinic?.tgBotToken) };
  });

  let smsLabel: string | null = null;
  let smsCfg: Record<string, unknown> | null = null;
  let tgLabel: string | null = null;
  let tgCfg: Record<string, unknown> | null = null;
  for (const r of rows) {
    if (r.kind === "SMS") {
      smsLabel = r.label ?? null;
      smsCfg = (r.config as Record<string, unknown> | null) ?? null;
    } else if (r.kind === "TELEGRAM") {
      tgLabel = r.label ?? null;
      tgCfg = (r.config as Record<string, unknown> | null) ?? null;
    }
  }

  const sms = pickSms(smsLabel, smsCfg);
  const tg = pickTg(clinicId, tgLabel, tgCfg, hasBotToken);
  return {
    sms,
    tg,
    real: {
      sms: sms.name !== "log-only",
      tg: tg.name !== "log-only",
    },
  };
}

export { LogOnlySmsAdapter, LogOnlyTgAdapter, EskizSmsAdapter, TelegramClinicAdapter };
export type { SmsAdapter, TgAdapter };

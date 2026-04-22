/**
 * Telephony adapter factory.
 *
 * Picks the adapter at runtime based on `ProviderConnection`. Today
 * `ProviderKind` doesn't yet include `SIP` (see prisma schema), so we check
 * for a provider stored with `kind = OTHER` and `config.provider = "sip"` as
 * a forward-compatible hook. Falls back to `LogOnlyTelephonyAdapter` whenever
 * no active SIP provider is configured — which is the default across dev
 * and every clinic on day one.
 *
 * TODO(prisma-schema-owner): add `SIP` to `ProviderKind` when a real provider
 * is picked (OnlinePBX / Mango / UIS / Asterisk). At that point swap the
 * lookup below to `kind: "SIP"`.
 *
 * TODO(admin-platform-builder, Phase 4): build a settings UI that upserts a
 * ProviderConnection row (encrypted `secretCipher`, `config`, `active`) so
 * clinics can configure a real SIP provider without a DB edit.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import type { TelephonyAdapter } from "./adapter";
import { LogOnlyTelephonyAdapter } from "./log-only";

/**
 * Singleton — adapters are stateless, so a single instance per process is
 * sufficient. Tests may reset via `__setTelephonyForTests`.
 */
let singleton: TelephonyAdapter | null = null;

export function getTelephony(): TelephonyAdapter {
  if (!singleton) singleton = new LogOnlyTelephonyAdapter();
  return singleton;
}

/**
 * Resolve the adapter for a specific clinic. Cross-tenant lookup — uses
 * SYSTEM context internally. Returns the LogOnly adapter unless a real SIP
 * provider is configured.
 */
export async function resolveTelephonyForClinic(
  clinicId: string,
): Promise<TelephonyAdapter> {
  // Forward-compat: today `ProviderKind` has no `SIP`. Clinics needing a
  // real provider can temporarily park it under `kind: OTHER` with
  // `label: "sip"` until the enum is extended. When `SIP` lands, change the
  // filter to `{ kind: "SIP" }`.
  const conn = await runWithTenant({ kind: "SYSTEM" }, async () =>
    prisma.providerConnection.findFirst({
      where: { clinicId, active: true, kind: "OTHER", label: "sip" },
      select: { id: true, kind: true, config: true, label: true },
    }),
  );
  if (!conn) return getTelephony();
  // A real provider would branch here based on config.provider:
  //   switch (cfg.provider) {
  //     case 'onlinepbx': return new OnlinePbxAdapter(cfg);
  //     case 'mango':     return new MangoAdapter(cfg);
  //     ...
  //   }
  // Until one is wired, we continue to return LogOnly so the UI still works.
  return getTelephony();
}

/** Test helper: drop the singleton so the next `getTelephony()` re-instantiates. */
export function __setTelephonyForTests(next: TelephonyAdapter | null): void {
  singleton = next;
}

export type { TelephonyAdapter, TelephonyEvent } from "./adapter";
export { LogOnlyTelephonyAdapter } from "./log-only";

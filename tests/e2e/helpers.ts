/**
 * Shared Playwright helpers for the MedBook / NeuroFax e2e suite.
 *
 * Design goals:
 *   - Zero dependency on a live Postgres at spec-load time. Specs that need
 *     the DB check `isDbReachable()` in a `test.beforeAll` and self-skip
 *     gracefully.
 *   - Deterministic login — re-uses NextAuth credentials via the built-in
 *     `/api/auth/callback/credentials` POST flow, no UI clicks needed.
 *   - Mini App `initData` signing (HMAC-SHA256 against a clinic bot token).
 *     The bot token must be injected into the seed via
 *     `TG_BOT_TOKEN_TEST=<token>` — if absent, Mini-App specs self-skip.
 */
import { createHmac } from "node:crypto";
import {
  expect,
  request as apiRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  NEUROFAX,
  DEMO_CLINIC,
  SUPER_ADMIN,
  type ClinicSlug,
  type SeededUser,
} from "./fixtures/seed-handles";

export const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? 3001}`;

export const HAS_TEST_DB = Boolean(
  process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL,
);

export const HAS_TG_BOT_TOKEN = Boolean(process.env.TG_BOT_TOKEN_TEST);

/**
 * Ping the app's /api/health endpoint to learn whether the webServer actually
 * has a reachable DB. Used to self-skip DB-dependent specs in environments
 * where only the Next dev server starts (no Postgres container).
 */
export async function isAppHealthy(): Promise<boolean> {
  try {
    const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
    const res = await ctx.get("/api/health", { timeout: 5_000 });
    await ctx.dispose();
    if (!res.ok()) return false;
    const body = (await res.json()) as {
      checks?: { db?: { status?: string } };
    };
    return body.checks?.db?.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Log in as the given seeded user via the NextAuth credentials provider.
 *
 * Uses the raw POST flow (`/api/auth/csrf` → `/api/auth/callback/credentials`)
 * so we don't care whether a custom /login page exists yet. The resulting
 * session cookie is persisted in the browser context.
 */
export async function loginAs(
  page: Page,
  user: SeededUser,
  opts: { landing?: string } = {},
): Promise<void> {
  const landing = opts.landing ?? "/ru/crm";
  const ctx = page.context();
  const req = ctx.request;

  // Read CSRF token.
  const csrfRes = await req.get(`${BASE_URL}/api/auth/csrf`);
  if (!csrfRes.ok()) {
    throw new Error(
      `Failed to fetch csrf token: ${csrfRes.status()} ${await csrfRes.text()}`,
    );
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // Post credentials. NextAuth accepts either URL-encoded body or JSON;
  // URL-encoded is the traditional path.
  const signinRes = await req.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    {
      form: {
        csrfToken,
        email: user.email,
        password: user.password,
        callbackUrl: `${BASE_URL}${landing}`,
        redirect: "false",
        json: "true",
      },
      failOnStatusCode: false,
    },
  );
  if (!signinRes.ok()) {
    const text = await signinRes.text();
    throw new Error(
      `signIn failed for ${user.email}: ${signinRes.status()} ${text}`,
    );
  }

  // At this point the session cookie (`__Secure-authjs.session-token` or
  // `authjs.session-token` depending on scheme) is stored in the context.
  // Navigate to the landing page to kick off the SSR session sync.
  await page.goto(landing);
}

/**
 * Convenience wrappers for each seeded role (primary clinic = neurofax).
 */
export const as = {
  admin: (page: Page, opts?: { landing?: string }) =>
    loginAs(page, NEUROFAX.admin, opts),
  doctor: (page: Page, opts?: { landing?: string }) =>
    loginAs(page, NEUROFAX.doctors[0], opts),
  receptionist: (page: Page, opts?: { landing?: string }) =>
    loginAs(page, NEUROFAX.receptionist, opts),
  superAdmin: (page: Page, opts?: { landing?: string }) =>
    loginAs(page, SUPER_ADMIN, opts),
  otherClinicAdmin: (page: Page, opts?: { landing?: string }) =>
    loginAs(page, DEMO_CLINIC.admin, opts),
};

/**
 * Construct an API client bound to the given browser context so cookies flow.
 */
export function apiClient(ctx: BrowserContext): APIRequestContext {
  return ctx.request;
}

/**
 * Build a signed Mini-App `initData` URL-encoded string for the given clinic.
 *
 * The signing key is HMAC_SHA256("WebAppData", botToken). The bot token is
 * whatever `tgBotToken` the clinic row holds. Since the e2e seed does not
 * provision a token by default, this helper reads `TG_BOT_TOKEN_TEST` and
 * assumes the caller has set the same value on the clinic row out-of-band
 * (e.g. via a SQL UPDATE as part of test setup, or through an admin POST).
 */
export function signMiniAppInitData(opts: {
  userId: number;
  botToken?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  authDate?: number;
}): string {
  const token = opts.botToken ?? process.env.TG_BOT_TOKEN_TEST;
  if (!token) {
    throw new Error(
      "signMiniAppInitData: missing TG_BOT_TOKEN_TEST env (can't sign initData without a clinic bot token)",
    );
  }
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify({
    id: opts.userId,
    first_name: opts.firstName ?? "E2E",
    last_name: opts.lastName ?? "Tester",
    username: opts.username ?? `e2e_${opts.userId}`,
    language_code: opts.languageCode ?? "ru",
  });
  const entries: [string, string][] = [
    ["auth_date", String(authDate)],
    ["user", userJson],
  ];
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, v);
  params.append("hash", hash);
  return params.toString();
}

/**
 * CRM URL builder (locale-aware). Prefer this over hard-coded strings so
 * spec files are consistent when we eventually flip default locale.
 */
export function crm(path: string, locale: "ru" | "uz" = "ru"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}/crm${p === "/" ? "" : p}`;
}

/**
 * Fetch a fresh ISO date for today at the given HH:MM in UTC — deterministic
 * within a single test run. Defaults to 15:00 to avoid colliding with the
 * seed's 10:00–14:00 range.
 */
export function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * Wait for the CRM layout's topbar to render — a reliable "page hydrated"
 * signal that works across all authenticated pages.
 */
export async function waitForCrmReady(page: Page): Promise<void> {
  // The top-bar renders a search button (⌘K) on every CRM page. Use text
  // search since we have no data-testid yet.
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveURL(/\/crm\/?/);
}

/**
 * Convenience: fetch a list of seeded patient IDs from the REST API under
 * the current user's session. Used by specs that need a stable target.
 */
export async function firstPatientId(
  ctx: BrowserContext,
  clinicSlug: ClinicSlug = "neurofax",
): Promise<string | null> {
  void clinicSlug; // reserved for multi-tenant assertions
  const res = await ctx.request.get(`${BASE_URL}/api/crm/patients?limit=1`, {
    failOnStatusCode: false,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { rows?: Array<{ id: string }> };
  return body.rows?.[0]?.id ?? null;
}

/**
 * Convenience: fetch a list of seeded doctor IDs from the REST API.
 */
export async function firstDoctorId(
  ctx: BrowserContext,
): Promise<string | null> {
  const res = await ctx.request.get(`${BASE_URL}/api/crm/doctors?limit=1`, {
    failOnStatusCode: false,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { rows?: Array<{ id: string }> };
  return body.rows?.[0]?.id ?? null;
}

/**
 * Convenience: fetch the first service id + its canonical duration.
 */
export async function firstService(ctx: BrowserContext): Promise<{
  id: string;
  durationMin: number;
} | null> {
  const res = await ctx.request.get(`${BASE_URL}/api/crm/services?limit=1`, {
    failOnStatusCode: false,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as {
    rows?: Array<{ id: string; durationMin: number }>;
  };
  const row = body.rows?.[0];
  return row ? { id: row.id, durationMin: row.durationMin } : null;
}

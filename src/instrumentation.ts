/**
 * Next.js 16 instrumentation hook.
 *
 * Called once per server instance. We use it to wire Sentry when the DSN
 * is provided; otherwise it's a no-op so local dev and the test suite
 * don't pay any cost.
 *
 * Sentry is loaded with a dynamic import so the dependency is only
 * required when `SENTRY_DSN` is set. This keeps the default docker image
 * lean and the test suite green without mocking the SDK.
 *
 * See: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 */

import { getTenant } from "@/lib/tenant-context";

type SentryModule = {
  init: (opts: Record<string, unknown>) => void;
  setContext: (name: string, ctx: Record<string, unknown>) => void;
  setTag?: (key: string, value: string) => void;
  captureException?: (err: unknown) => void;
};

let sentryRef: SentryModule | null = null;

// Function-wrapped dynamic import so TypeScript doesn't try to resolve
// @sentry/nextjs at compile-time — it's an optional runtime dependency.
const dynamicImport = new Function("spec", "return import(spec)") as (
  spec: string,
) => Promise<unknown>;

export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  let Sentry: SentryModule;
  try {
    Sentry = (await dynamicImport("@sentry/nextjs")) as SentryModule;
  } catch (e) {
    console.warn(
      "[instrumentation] SENTRY_DSN set but @sentry/nextjs is not installed. " +
        "Skipping Sentry init. Install with `npm install @sentry/nextjs`. " +
        "Error:",
      e instanceof Error ? e.message : e,
    );
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    // Ignore 404 / auth errors — they're expected.
    ignoreErrors: [
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
      "NEXT_HTTP_ERROR_FALLBACK;404",
    ],
  });

  sentryRef = Sentry;
  console.info("[instrumentation] Sentry initialised");
}

/**
 * Next 16 calls this when any server error bubbles out of a route handler or
 * RSC render. We forward to Sentry (if configured) and tag the event with the
 * active `TenantContext` from AsyncLocalStorage — so dashboards can pivot on
 * `clinicId` + `userId`.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: "App Router" | "Pages Router"; routePath: string; routeType: string },
): Promise<void> {
  if (!sentryRef) return;

  const tenant = getTenant();
  const tagCtx: Record<string, unknown> = {
    path: request.path,
    method: request.method,
    route: context.routePath,
  };
  if (tenant?.kind === "TENANT") {
    tagCtx.clinicId = tenant.clinicId;
    tagCtx.userId = tenant.userId;
    tagCtx.role = tenant.role;
    sentryRef.setTag?.("clinicId", tenant.clinicId);
    sentryRef.setTag?.("userId", tenant.userId);
    sentryRef.setTag?.("role", tenant.role);
  } else if (tenant?.kind === "SUPER_ADMIN") {
    tagCtx.userId = tenant.userId;
    tagCtx.role = "SUPER_ADMIN";
    sentryRef.setTag?.("role", "SUPER_ADMIN");
    sentryRef.setTag?.("userId", tenant.userId);
  } else if (tenant?.kind === "SYSTEM") {
    sentryRef.setTag?.("role", "SYSTEM");
  }
  sentryRef.setContext("request", tagCtx);
  sentryRef.captureException?.(err);
}

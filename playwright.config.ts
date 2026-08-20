import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for MedBook / NeuroFax Phase-7 e2e suite.
 *
 * Conventions:
 *   - tests live in `tests/e2e/**`
 *   - seed is idempotent: `npm run e2e:seed`
 *   - dev server runs on 3001 so it does not collide with the running
 *     local `next dev` on 3000. Override by exporting `E2E_PORT`.
 *   - The webServer auto-starts `next dev` against `DATABASE_URL_TEST`
 *     (or falls back to `DATABASE_URL`).
 *
 * CI:
 *   - `workers: 1` on CI (serial) — tests share a seeded DB.
 *   - traces + screenshots captured on first retry.
 */

const PORT = Number(process.env.E2E_PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// NB: do NOT pass `--hostname 127.0.0.1` here. Under Next 16 an explicit
// hostname makes the dev server canonicalize its origin as `localhost:<port>`,
// which turns next-intl's locale rewrite of `/` into an absolute cross-origin
// URL — Next then answers `307 → /` forever and the webServer readiness
// check times out. Without the flag the rewrite stays relative and `/` is 200.
const startCommand =
  process.env.E2E_START_COMMAND ?? `next dev --port ${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/fixtures/**", "**/helpers.ts", "**/seed.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Single worker everywhere: the suite shares one seeded DB and several
  // specs (23/24/25) temporarily flip the seeded clinic's plan — a second
  // worker hitting feature-gated routes mid-flip would flake.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // Disable service workers to keep fixtures deterministic.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "chromium-mobile",
      // Mini App flows (mobile viewport). Only a handful of specs target it;
      // see tests/e2e/miniapp-booking.spec.ts.
      testMatch: /miniapp-.*\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: startCommand,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          // NB: no NODE_ENV here — `next dev` and `next start` each set the
          // right mode themselves, and forcing "development" breaks
          // E2E_START_COMMAND="next start …" (the recommended, flake-free
          // way to run the suite against a prebuilt production bundle).
          PORT: String(PORT),
          // Test DB — falls back to prod DB url if not provided.
          DATABASE_URL:
            process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "",
          AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-auth-secret-32bytes-minimum-padding",
          APP_SECRET: process.env.APP_SECRET ?? "e2e-app-secret-32bytes-minimum-padding!",
          AUTH_URL: baseURL,
          NEXT_TELEMETRY_DISABLED: "1",
          E2E: "1",
          // Prod runs with the doctor cabinet unpaused (kill-switch env set).
          // Without it every DOCTOR login bounces in a /crm ↔ /doctor
          // redirect loop (the CRM layout redirect ignores the kill-switch).
          DOCTOR_CABINET_ENABLED: "1",
        },
      },
});

/**
 * Call-center booking RBAC — screen-level reproduction.
 *
 * Boss report: "где-то запись недоступна". Root cause: the permission matrix
 * (src/lib/permissions/matrix.ts) grants CALL_OPERATOR write/update on the
 * Appointment resource, but POST /api/crm/appointments hard-codes
 * `roles: ["ADMIN", "RECEPTIONIST"]` (route.ts:159) — so a call-center operator
 * can SEE doctors / slots (the GET endpoints allow them) yet gets a 403 the
 * moment they hit "Записать". From the screen that reads as "запись недоступна".
 *
 * This spec drives the real New Appointment dialog through the UI (opened with
 * the F2 shortcut, which is not role-gated):
 *   1. CALL_OPERATOR fills a valid booking and submits → POST returns 403,
 *      an error toast ("Forbidden") shows, the dialog stays open. (the bug)
 *   2. RECEPTIONIST does the identical flow → POST 2xx, dialog closes. (control)
 *
 * Both capture a screenshot as proof under test-results/.
 */
import { test, expect, type Page } from "@playwright/test";

import { HAS_TEST_DB, as, isAppHealthy } from "./helpers";

// Seed handles (tests/e2e/seed.ts) — neurologist + first patient on neurofax.
const DOCTOR_NAME = "Ахмедов Акмаль Ботирович";
const PATIENT_NAME = "Иванов Иван Иванович";

/** Next weekday `daysAhead` out, as YYYY-MM-DD, nudged off Sat/Sun so we land
 *  inside the seed's Mon–Fri 09:00–18:00 doctor schedule. */
function futureWeekdayInput(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/**
 * Open the New Appointment dialog via F2 and fill a minimal valid booking
 * (patient + doctor + date + first free slot). Services are optional per
 * CreateAppointmentSchema, so we skip that combobox for determinism.
 * Returns the dialog locator, primed and ready to submit.
 */
async function openAndFillBooking(page: Page) {
  await page.keyboard.press("F2");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // 1. Patient — type into the autocomplete and pick the seeded match.
  const patientInput = dialog.getByRole("textbox").first();
  await patientInput.click();
  await patientInput.fill("Иванов");
  await page.getByRole("button", { name: new RegExp(PATIENT_NAME) }).click();

  // 2. Doctor — first combobox in the dialog (Radix Select).
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: DOCTOR_NAME }).click();

  // 3. Date — a future weekday so the seeded schedule yields slots.
  await dialog.locator("#slot-date").fill(futureWeekdayInput());

  // 4. Slot — first available HH:mm chip (role=radio).
  const firstSlot = dialog.getByRole("radio").first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  return dialog;
}

/** Submit and resolve the create POST's response (the rock-solid RBAC signal). */
async function submitAndCaptureCreate(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/crm/appointments") &&
        r.request().method() === "POST",
      // The POST route compiles cold on its first hit under `next dev`.
      { timeout: 60_000 },
    ),
    dialog.locator('button[type="submit"]').click(),
  ]);
  return resp;
}

test.describe("call-center booking RBAC (screen)", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("CALL_OPERATOR is blocked at submit (403 'запись недоступна')", async ({
    page,
  }) => {
    // We drive the UI under the `uz` locale. The `ru` default is served
    // prefix-less (`localePrefix: as-needed`), and `next dev` + next-intl 4.9
    // self-redirect that un-prefixed path in a loop — a dev-only quirk that
    // never reaches `next start`/prod. `uz` renders cleanly and the RBAC gate
    // under test is wholly locale-agnostic, so this is the same screen flow.
    // Land directly on the call-center surface in a single navigation — the
    // operator's home, and proof they reach a booking-capable screen. (Chaining
    // a second goto after login races the SSR redirect and aborts in dev.)
    await as.callOperator(page, { landing: "/uz/crm/call-center" });

    const dialog = await openAndFillBooking(page);
    const resp = await submitAndCaptureCreate(page, dialog);

    // The bug: a valid booking is rejected purely on role.
    expect(resp.status()).toBe(403);

    // On-screen evidence: error toast + the dialog does NOT close.
    await expect(page.getByText("Forbidden")).toBeVisible();
    await expect(dialog).toBeVisible();

    await page.screenshot({
      path: "test-results/callcenter-operator-blocked.png",
      fullPage: true,
    });
  });

  test("RECEPTIONIST completes the same booking (control)", async ({ page }) => {
    await as.receptionist(page, { landing: "/uz/crm/appointments" });

    const dialog = await openAndFillBooking(page);
    const resp = await submitAndCaptureCreate(page, dialog);

    expect([200, 201]).toContain(resp.status());
    // Success closes the dialog — but only after the post-create case-resolution
    // POSTs settle, so allow generous headroom for their cold first compile.
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await page.screenshot({
      path: "test-results/receptionist-booking-ok.png",
      fullPage: true,
    });
  });
});

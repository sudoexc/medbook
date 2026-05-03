/**
 * Probes the /api/crm/payments POST endpoint directly to surface the 500
 * error stack from the dev server console. Logs in as receptionist, finds
 * a today-completed appointment, and POSTs a payment.
 */
import "dotenv/config";

const BASE = "http://localhost:3000";
const EMAIL = "recept@neurofax.uz";
const PASS = "recept";

interface CookieJar {
  cookies: Map<string, string>;
}
function newJar(): CookieJar {
  return { cookies: new Map() };
}
function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function ingest(jar: CookieJar, res: Response): void {
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const raw of sc) {
    const piece = raw.split(";")[0];
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    jar.cookies.set(piece.slice(0, eq), piece.slice(eq + 1));
  }
}

async function login(jar: CookieJar) {
  // 1. CSRF
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  ingest(jar, csrfRes);
  const { csrfToken } = await csrfRes.json();

  // 2. Credentials post
  const formData = new URLSearchParams({
    email: EMAIL,
    password: PASS,
    csrfToken,
    callbackUrl: "/",
    json: "true",
  });
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: formData,
  });
  ingest(jar, r);
  console.log("login status:", r.status);
}

async function main() {
  const jar = newJar();
  await login(jar);

  const r = await fetch(
    `${BASE}/api/crm/appointments?dateFrom=2026-05-03&dateTo=2026-05-04&status=COMPLETED&limit=5`,
    { headers: { Cookie: cookieHeader(jar) } }
  );
  console.log("list status:", r.status);
  const j = await r.json();
  console.log("rows:", j.rows?.length ?? 0);
  if (!j.rows?.length) {
    console.log("no completed today; aborting");
    return;
  }
  const first = j.rows[0];
  console.log("target appt:", first.id, "patientId:", first.patientId);

  // Fetch full appt to get priceFinal
  const a = await fetch(`${BASE}/api/crm/appointments/${first.id}`, {
    headers: { Cookie: cookieHeader(jar) },
  });
  const aj = await a.json();
  const priceFinal = aj.priceFinal ?? 50_000;
  console.log("priceFinal:", priceFinal);

  // Try payment POST
  const p = await fetch(`${BASE}/api/crm/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({
      appointmentId: first.id,
      patientId: first.patientId,
      currency: "UZS",
      amount: priceFinal,
      method: "CASH",
      status: "PAID",
    }),
  });
  console.log("payment POST status:", p.status);
  const pt = await p.text();
  console.log("payment body:", pt);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

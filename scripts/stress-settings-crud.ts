/**
 * E2E stress for settings CRUD on `neurofax`. Logs in as admin and
 * exercises POST/PATCH/DELETE on every settings entity, plus the audit
 * log readback. Idempotent: tags every created row with `STRESS-` so
 * repeat runs upsert / cleanup deterministically.
 */
import "dotenv/config";

const BASE = process.env.STRESS_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = "1@1.uz";
const ADMIN_PASS = "1";

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

interface Result {
  group: string;
  name: string;
  pass: boolean;
  detail?: string;
}
const results: Result[] = [];
function record(r: Result) {
  const tick = r.pass ? "✓" : "✗";
  console.log(`${tick} [${r.group}] ${r.name}${r.detail ? " — " + r.detail : ""}`);
  results.push(r);
}

async function login(jar: CookieJar) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  ingest(jar, csrfRes);
  const { csrfToken } = await csrfRes.json();
  const formData = new URLSearchParams({
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
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
  if (r.status >= 400) throw new Error(`login failed ${r.status}`);
}

async function api<T = unknown>(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T | null; raw: string }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      ...(extraHeaders ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  ingest(jar, r);
  const raw = await r.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    data = null;
  }
  return { status: r.status, data, raw };
}

async function main() {
  const jar = newJar();
  await login(jar);
  console.log("✓ admin logged in");

  // ── CABINETS ────────────────────────────────────────────────────────────
  {
    const num = `STRESS-CRUD-${Date.now() % 100_000}`;
    const c = await api<{ id: string }>(jar, "POST", "/api/crm/cabinets", {
      number: num,
      floor: 7,
      nameRu: "Стресс-кабинет CRUD",
      nameUz: "Stress kabinet CRUD",
      equipment: ["МРТ"],
    });
    record({
      group: "cabinets",
      name: "POST",
      pass: c.status === 201 && !!c.data?.id,
      detail: `${c.status} id=${c.data?.id ?? "n/a"}`,
    });
    if (c.data?.id) {
      const u = await api(jar, "PATCH", `/api/crm/cabinets/${c.data.id}`, {
        floor: 8,
        nameRu: "Стресс-кабинет переименован",
      });
      record({ group: "cabinets", name: "PATCH", pass: u.status === 200, detail: `${u.status}` });
      const d = await api(jar, "DELETE", `/api/crm/cabinets/${c.data.id}`);
      record({
        group: "cabinets",
        name: "DELETE",
        pass: d.status === 200 || d.status === 204,
        detail: `${d.status}`,
      });
    }
  }

  // ── SERVICES (need at least one doctor to link) ────────────────────────
  const docList = await api<{ rows: Array<{ id: string }> }>(
    jar,
    "GET",
    "/api/crm/doctors?limit=2",
  );
  const linkDoctorIds = docList.data?.rows?.map((r) => r.id).slice(0, 2) ?? [];
  {
    const code = `STRESS-CRUD-${Date.now() % 100_000}`;
    const s = await api<{ id: string }>(jar, "POST", "/api/crm/services", {
      code,
      nameRu: "Стресс-услуга",
      nameUz: "Stress xizmat",
      durationMin: 25,
      priceBase: 99_000,
      category: "Стресс",
      doctorIds: linkDoctorIds,
    });
    record({
      group: "services",
      name: "POST",
      pass: s.status === 201 && !!s.data?.id,
      detail: `${s.status} id=${s.data?.id ?? "n/a"} body=${s.raw.slice(0, 200)}`,
    });
    if (s.data?.id) {
      const u = await api(jar, "PATCH", `/api/crm/services/${s.data.id}`, {
        priceBase: 120_000,
        durationMin: 30,
      });
      record({ group: "services", name: "PATCH price+duration", pass: u.status === 200, detail: `${u.status}` });
      const d = await api(jar, "DELETE", `/api/crm/services/${s.data.id}`);
      record({
        group: "services",
        name: "DELETE",
        pass: d.status === 200 || d.status === 204,
        detail: `${d.status}`,
      });
    }
  }

  // ── DOCTORS (with schedule). Phase 11 binds 1:1 to a cabinet — we need
  // a fresh, unbound cabinet to avoid hijacking an existing doctor's room.
  let doctorId: string | undefined;
  let scratchCabId: string | undefined;
  {
    const cabNum = `STRESS-DOC-${Date.now() % 100_000}`;
    const cab = await api<{ id: string }>(jar, "POST", "/api/crm/cabinets", {
      number: cabNum,
      floor: 9,
      nameRu: "Кабинет под стресс-врача",
    });
    scratchCabId = cab.data?.id;

    const slug = `stress-crud-${Date.now() % 100_000}`;
    const d = await api<{ id: string }>(jar, "POST", "/api/crm/doctors", {
      slug,
      nameRu: "Стресс CRUD Врачов",
      nameUz: "Stress CRUD Vrachov",
      specializationRu: "Невролог",
      specializationUz: "Nevrolog",
      pricePerVisit: 200_000,
      salaryPercent: 35,
      color: "#FF00FF",
      cabinetId: scratchCabId,
    });
    record({
      group: "doctors",
      name: "POST",
      pass: d.status === 201 && !!d.data?.id,
      detail: `${d.status} id=${d.data?.id ?? "n/a"} body=${d.raw.slice(0, 200)}`,
    });
    doctorId = d.data?.id;
    if (doctorId) {
      const u = await api(jar, "PATCH", `/api/crm/doctors/${doctorId}`, {
        salaryPercent: 50,
      });
      record({
        group: "doctors",
        name: "PATCH commission",
        pass: u.status === 200,
        detail: `${u.status}`,
      });

      // Replace schedule (PUT replaces entire week atomically)
      const sched = await api(jar, "PUT", `/api/crm/doctors/${doctorId}/schedule`, {
        entries: [
          { weekday: 1, startTime: "10:00", endTime: "16:00" },
          { weekday: 3, startTime: "09:00", endTime: "13:00" },
          { weekday: 5, startTime: "14:00", endTime: "18:00" },
        ],
      });
      record({
        group: "doctors",
        name: "PUT schedule (3 days)",
        pass: sched.status === 200,
        detail: `${sched.status}`,
      });

      // Time-off (POST) — schema uses startAt/endAt, not from/to
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(13, 0, 0, 0);
      const off = await api(jar, "POST", `/api/crm/doctors/${doctorId}/time-off`, {
        startAt: tomorrow.toISOString(),
        endAt: tomorrowEnd.toISOString(),
        reason: "Stress-test off",
      });
      record({
        group: "doctors",
        name: "POST time-off (+1d 10-13)",
        pass: off.status === 201 || off.status === 200,
        detail: `${off.status}`,
      });
    }
  }

  // ── USERS ──────────────────────────────────────────────────────────────
  {
    const stamp = Date.now() % 100_000;
    const email = `stress-crud-${stamp}@neurofax.uz`;
    const c = await api<{ id?: string; tempPassword?: string }>(
      jar,
      "POST",
      "/api/crm/users",
      {
        email,
        name: "Стресс CRUD Юзеров",
        role: "RECEPTIONIST",
      },
    );
    record({
      group: "users",
      name: "POST RECEPTIONIST",
      pass: (c.status === 201 || c.status === 200) && !!c.data?.id,
      detail: `${c.status} tempPass=${c.data?.tempPassword ? "yes" : "no"}`,
    });
    const userId = c.data?.id;
    if (userId) {
      const u = await api(jar, "PATCH", `/api/crm/users/${userId}`, {
        name: "Стресс CRUD Юзеров (renamed)",
        active: true,
      });
      record({ group: "users", name: "PATCH name", pass: u.status === 200, detail: `${u.status}` });

      // Reset password (admin action)
      const reset = await api(jar, "POST", `/api/crm/users/${userId}/reset-password`, {});
      record({
        group: "users",
        name: "POST reset-password",
        pass: reset.status === 200 || reset.status === 201,
        detail: `${reset.status}`,
      });

      // Bind doctor (link existing doctor) — if we created one above
      if (doctorId) {
        const bind = await api(jar, "PATCH", `/api/crm/users/${userId}`, {
          role: "DOCTOR",
          doctorId,
        });
        record({
          group: "users",
          name: "PATCH role→DOCTOR + bind",
          pass: bind.status === 200,
          detail: `${bind.status}`,
        });
      }

      // Last-ADMIN guard probe: try to deactivate the only ADMIN. We do this
      // by finding the current admin (not us) — but to play it safe we test
      // by attempting to deactivate the dev admin (1@1.uz) which IS
      // currently logged in. Should 409/422.
      const me = await api<{ id: string }>(jar, "GET", "/api/crm/me");
      const myId = me.data?.id;
      if (myId) {
        const guard = await api(jar, "PATCH", `/api/crm/users/${myId}`, { active: false });
        record({
          group: "users",
          name: "last-ADMIN guard: deactivate-self blocked",
          pass: guard.status === 409 || guard.status === 422 || guard.status === 400,
          detail: `${guard.status}`,
        });
      }

      // DELETE the test user
      const d = await api(jar, "DELETE", `/api/crm/users/${userId}`);
      record({
        group: "users",
        name: "DELETE",
        pass: d.status === 200 || d.status === 204,
        detail: `${d.status}`,
      });
    }

    // Cleanup created doctor too
    if (doctorId) {
      const dd = await api(jar, "DELETE", `/api/crm/doctors/${doctorId}`);
      record({
        group: "doctors",
        name: "DELETE",
        pass: dd.status === 200 || dd.status === 204,
        detail: `${dd.status}`,
      });
    }
    if (scratchCabId) {
      await api(jar, "DELETE", `/api/crm/cabinets/${scratchCabId}`);
    }
  }

  // ── BRANCHES ───────────────────────────────────────────────────────────
  {
    const slug = `stress-crud-${Date.now() % 100_000}`;
    const b = await api<{ id: string }>(jar, "POST", "/api/crm/branches", {
      slug,
      nameRu: "Стресс филиал",
      nameUz: "Stress filial",
      address: "ул. Стрессовая 1",
      isDefault: false,
    });
    record({
      group: "branches",
      name: "POST",
      pass: b.status === 201 && !!b.data?.id,
      detail: `${b.status} id=${b.data?.id ?? "n/a"}`,
    });
    if (b.data?.id) {
      const u = await api(jar, "PATCH", `/api/crm/branches/${b.data.id}`, {
        nameRu: "Стресс филиал (renamed)",
      });
      record({ group: "branches", name: "PATCH", pass: u.status === 200, detail: `${u.status}` });
      const d = await api(jar, "DELETE", `/api/crm/branches/${b.data.id}`);
      record({
        group: "branches",
        name: "DELETE",
        pass: d.status === 200 || d.status === 204,
        detail: `${d.status}`,
      });
    }
  }

  // ── CLINIC settings (PATCH) ─────────────────────────────────────────────
  {
    const c = await api<{ nameRu: string }>(jar, "GET", "/api/crm/clinic");
    record({
      group: "clinic",
      name: "GET clinic",
      pass: c.status === 200,
      detail: `${c.status} nameRu=${c.data?.nameRu ?? "n/a"}`,
    });
    if (c.status === 200) {
      const u = await api(jar, "PATCH", "/api/crm/clinic", {
        addressRu: "ул. Стрессовая, 9 (test)",
      });
      record({
        group: "clinic",
        name: "PATCH address",
        pass: u.status === 200,
        detail: `${u.status}`,
      });
    }
  }

  // ── AUDIT log readback ─────────────────────────────────────────────────
  {
    const a = await api<{ rows: Array<{ action: string; createdAt: string }> }>(
      jar,
      "GET",
      "/api/crm/audit?limit=50",
    );
    record({
      group: "audit",
      name: "GET audit log (last 50)",
      pass: a.status === 200 && Array.isArray(a.data?.rows),
      detail: `${a.status} rows=${a.data?.rows?.length ?? 0}`,
    });
    // Verify our just-fired CRUD operations show up. user.create is a near
    // certainty since we created/deleted a user above.
    const hasUserCreate = a.data?.rows?.some((r) => r.action === "user.create") ?? false;
    record({
      group: "audit",
      name: "audit captured user.create from this run",
      pass: hasUserCreate,
      detail: hasUserCreate ? "yes" : "no",
    });
  }

  // ── FINAL summary ──────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed} / ${results.length} passed ===`);
  if (passed < results.length) {
    console.log("Failures:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  - [${r.group}] ${r.name} ${r.detail ?? ""}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

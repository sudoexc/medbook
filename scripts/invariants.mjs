/**
 * Numeric invariants audit.
 *
 * Schema notes (verified via information_schema):
 *   - Appointment uses `date` (timestamp, includes time-of-day) and `endDate`
 *     (timestamp). No startAt/endAt columns.
 *   - Patient.balance (not balanceTiins). Money columns in minor units.
 *   - Invoice.amountTiins, no InvoiceItem table → invoice/items reconcile skipped.
 *   - Payment.amount (not amountTiins), has idempotencyKey.
 */
import pg from "pg";

const CONN = process.env.DATABASE_URL || "postgresql://joe@localhost:5432/neurofax";
const c = new pg.Client({ connectionString: CONN });
await c.connect();

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const TODAY_ISO = TODAY.toISOString().slice(0, 10);

const findings = [];
function note(level, label, detail) {
  findings.push({ level, label, detail });
  console.log(`[${level}] ${label}: ${detail}`);
}

console.log("=== DB-LEVEL NUMERIC INVARIANTS ===\n");

// 1. Tenant isolation
const r1 = await c.query(`SELECT COUNT(*)::int AS n FROM "Appointment" WHERE "clinicId" IS NULL`);
if (r1.rows[0].n > 0) note("BLOCKER", "Appointments without clinicId", `${r1.rows[0].n} rows`);
else note("OK", "Appointments tenant scope", "all rows have clinicId");

const r2 = await c.query(`SELECT COUNT(*)::int AS n FROM "Patient" WHERE "clinicId" IS NULL`);
if (r2.rows[0].n > 0) note("BLOCKER", "Patients without clinicId", `${r2.rows[0].n} rows`);
else note("OK", "Patients tenant scope", "all rows have clinicId");

const r3 = await c.query(`SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "clinicId" IS NULL`);
if (r3.rows[0].n > 0) note("BLOCKER", "Invoices without clinicId", `${r3.rows[0].n} rows`);
else note("OK", "Invoices tenant scope", "all rows have clinicId");

const rPay = await c.query(`SELECT COUNT(*)::int AS n FROM "Payment" WHERE "clinicId" IS NULL`);
if (rPay.rows[0].n > 0) note("BLOCKER", "Payments without clinicId", `${rPay.rows[0].n} rows`);
else note("OK", "Payments tenant scope", "all rows have clinicId");

// 2. Patient.balance vs payments (Invoice has no patientId; clinic-only).
//    Best we can do here: balance ≈ -Σ Payment.amount (paid lowers balance).
const r5 = await c.query(`
  SELECT
    p.id, p.balance AS storedBalance,
    COALESCE((SELECT SUM(amount) FROM "Payment" WHERE "patientId" = p.id), 0) AS paid
  FROM "Patient" p
  WHERE p.balance <> 0
  LIMIT 5
`);
note("INFO", "Patient balance sample (vs payments)", r5.rows.length === 0 ? "no nonzero balances" : JSON.stringify(r5.rows));

// 3. Appointments today by clinic — using `date` (timestamp)
const r6 = await c.query(`
  SELECT "clinicId", COUNT(*)::int AS n
  FROM "Appointment"
  WHERE "date" >= $1::date AND "date" < ($1::date + INTERVAL '1 day')
  GROUP BY "clinicId"
`, [TODAY_ISO]);
note("INFO", "Appointments today by clinic", r6.rows.length === 0 ? "(none)" : r6.rows.map(r => `${r.clinicId}=${r.n}`).join(", "));

// 4. Orphan appointments → patient
const r7 = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM "Appointment" a
  LEFT JOIN "Patient" p ON p.id = a."patientId"
  WHERE a."patientId" IS NOT NULL AND p.id IS NULL
`);
if (r7.rows[0].n > 0) note("HIGH", "Orphan appointments → patient", `${r7.rows[0].n} rows`);
else note("OK", "Appointment→Patient FK", "no orphans");

// 5. Orphan appointments → doctor
const r8 = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM "Appointment" a
  LEFT JOIN "Doctor" d ON d.id = a."doctorId"
  WHERE a."doctorId" IS NOT NULL AND d.id IS NULL
`);
if (r8.rows[0].n > 0) note("HIGH", "Orphan appointments → doctor", `${r8.rows[0].n} rows`);
else note("OK", "Appointment→Doctor FK", "no orphans");

// 6. Overlapping appointments per doctor (BOOKED+IN_PROGRESS+COMPLETED treated as committed)
const r9 = await c.query(`
  WITH ranged AS (
    SELECT a1.id AS a, a2.id AS b, a1."doctorId"
    FROM "Appointment" a1
    JOIN "Appointment" a2
      ON a1."doctorId" = a2."doctorId"
     AND a1."clinicId" = a2."clinicId"
     AND a1.id < a2.id
     AND a1.status NOT IN ('CANCELLED','NO_SHOW','SKIPPED')
     AND a2.status NOT IN ('CANCELLED','NO_SHOW','SKIPPED')
     AND a1."date"    < a2."endDate"
     AND a2."date"    < a1."endDate"
  )
  SELECT COUNT(*)::int AS n FROM ranged
`);
if (r9.rows[0].n > 0) note("HIGH", "Overlapping appointments per doctor", `${r9.rows[0].n} pairs — conflict-detection let some slip`);
else note("OK", "No overlapping appointments", "doctor schedule integrity holds");

// 7. NotificationSend orphans
const r10 = await c.query(`
  SELECT COUNT(*)::int AS n FROM "NotificationSend" s
  WHERE s."templateId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "NotificationTemplate" t WHERE t.id = s."templateId")
`).catch(e => ({ error: e.message }));
if (r10.error) note("INFO", "Notification orphan check", `query error: ${r10.error}`);
else if (r10.rows[0].n > 0) note("MEDIUM", "Orphan NotificationSend", `${r10.rows[0].n} rows reference deleted templates`);
else note("OK", "NotificationSend FK integrity", "no orphans");

// 8. AuditLog: tenant-bound actions all carry clinicId.
//    Some actions legitimately span tenants (self-signup pre-account, plus
//    SUPER_ADMIN-only session events). Treat those as expected nulls.
const r11 = await c.query(`
  SELECT COUNT(*)::int AS n FROM "AuditLog"
  WHERE "clinicId" IS NULL
    AND action NOT LIKE 'platform.%'
    AND action NOT LIKE 'super_admin.%'
    AND action NOT IN (
      'CLINIC_SELF_SIGNUP_REQUESTED',
      'CLINIC_SELF_SIGNUP_COMPLETED',
      'CONCURRENT_SESSION_KICKED',
      'session.clear_clinic'
    )
`).catch(e => ({ error: e.message }));
if (r11.error) note("INFO", "AuditLog check", `query error: ${r11.error}`);
else if (r11.rows[0].n > 0) note("MEDIUM", "AuditLog rows without clinicId", `${r11.rows[0].n} rows`);
else note("OK", "AuditLog tenant tagging", "ok");

// 9. Negative balances (credit on account; may be intentional)
const r12 = await c.query(`SELECT COUNT(*)::int AS n FROM "Patient" WHERE balance < 0`);
if (r12.rows[0].n > 0) note("INFO", "Patients with negative balance", `${r12.rows[0].n} rows (credit on account)`);
else note("OK", "No negative patient balances", "");

// 10. Appointment status distribution
const r13 = await c.query(`SELECT status, COUNT(*)::int AS n FROM "Appointment" GROUP BY status ORDER BY n DESC`);
console.log("\nAppointment status distribution:");
r13.rows.forEach(r => console.log(`  ${r.status}: ${r.n}`));

// 11. Payment idempotency-key duplicates (per clinic)
const rIdem = await c.query(`
  SELECT "clinicId", "idempotencyKey", COUNT(*)::int AS n
  FROM "Payment"
  WHERE "idempotencyKey" IS NOT NULL
  GROUP BY "clinicId", "idempotencyKey"
  HAVING COUNT(*) > 1
  LIMIT 5
`);
if (rIdem.rows.length > 0) note("HIGH", "Duplicate payment idempotency keys", `${rIdem.rows.length} dup groups; sample: ${JSON.stringify(rIdem.rows[0])}`);
else note("OK", "Payment idempotency keys unique", "no duplicates");

// 12. Invoice→Patient FK
const rInvP = await c.query(`
  SELECT COUNT(*)::int AS n
  FROM "Invoice" i
  WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Invoice' AND column_name='patientId')
`).catch(() => ({ rows: [{ n: 0 }] }));
// Invoice may not have patientId — Invoice schema only shows clinicId. Skip FK check there.

// 13. Status / queueStatus drift on Appointment (both use the same enum)
const rDrift = await c.query(`
  SELECT status, "queueStatus", COUNT(*)::int AS n
  FROM "Appointment"
  WHERE
    (status = 'IN_PROGRESS' AND "queueStatus" IN ('WAITING','BOOKED'))
    OR
    (status = 'COMPLETED' AND "queueStatus" IN ('WAITING','IN_PROGRESS'))
    OR
    (status IN ('CANCELLED','NO_SHOW') AND "queueStatus" IN ('WAITING','IN_PROGRESS'))
  GROUP BY status, "queueStatus"
  ORDER BY n DESC
`);
if (rDrift.rows.length > 0) note("MEDIUM", "Appointment status↔queueStatus drift", JSON.stringify(rDrift.rows));
else note("OK", "Appointment status ↔ queueStatus consistent", "");

console.log("\n=== SUMMARY ===");
const counts = { BLOCKER: 0, HIGH: 0, MEDIUM: 0, INFO: 0, OK: 0 };
findings.forEach(f => counts[f.level] = (counts[f.level] || 0) + 1);
console.log(`BLOCKER=${counts.BLOCKER} HIGH=${counts.HIGH} MEDIUM=${counts.MEDIUM} INFO=${counts.INFO} OK=${counts.OK}`);

await c.end();

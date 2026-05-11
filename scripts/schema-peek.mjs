import pg from "pg";
const c = new pg.Client({ connectionString: "postgresql://joe@localhost:5432/neurofax" });
await c.connect();
const r = await c.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = $1
     AND table_name = ANY($2)
   ORDER BY table_name, ordinal_position`,
  ["public", ["Appointment", "Patient", "Invoice", "Payment", "InvoiceItem", "InvoiceLine"]],
);
const byTable = {};
for (const row of r.rows) {
  byTable[row.table_name] ??= [];
  byTable[row.table_name].push(row.column_name);
}
for (const [k, v] of Object.entries(byTable)) console.log(k, v.join(","));
await c.end();

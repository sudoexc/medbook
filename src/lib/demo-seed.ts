/**
 * Marker on every row the demo seeds write next to real clinic data (audit
 * G2-01): `Patient.tags`, `Payment.externalRef` and the prefix of
 * `Payment.idempotencyKey` ("demo-seed:<appointmentId>").
 *
 * It lives in src/ so the app can tell those rows apart (the «does this
 * clinic record payments» rule of PT-08 ignores them) and the seed scripts
 * import the same value instead of a copy that could drift.
 *
 * Client-safe: no imports.
 */
export const DEMO_SEED_MARK = "demo-seed";

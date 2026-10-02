/**
 * Human-readable ticket code generator for Appointment.
 *
 * Crockford-style base32 alphabet — 30 chars, no visually ambiguous letters
 * (`0`, `1`, `I`, `L`, `O`, `U` omitted) so a patient can read the code off a
 * receipt and dictate it on the phone without "is that an O or a zero?".
 *
 * The code is the only key to the public /t/<code> resolver, which leads to
 * the patient's ticket (initials, doctor, service, time), so it is drawn
 * with `crypto.randomInt` (audit AP-15): `Math.random` is predictable from
 * a handful of outputs. 8 chars → 30^8 ≈ 6.6·10¹¹ combinations, which with
 * the resolver's per-IP rate limit makes walking the space hopeless; codes
 * printed before the change (6 chars) still resolve.
 *
 * Generation is pre-tx (one `findUnique` check); if the unique index still
 * rejects on insert (extreme race), the booking surfaces the standard P2002
 * error which the caller retries.
 */
import { randomInt } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 8;

export function randomTicketCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Generate a ticket code that is currently unused. Pre-checks the unique
 * index with a single `findUnique`; loops up to 8 times before giving up.
 * Caller is responsible for handling the rare race where two concurrent
 * generations pick the same code between the check and the insert (the unique
 * index in the DB is the final authority).
 */
export async function generateTicketCode(): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = randomTicketCode();
    // `ticketCode` is unique across ALL clinics, but in a clinic's request
    // the tenant extension pins the lookup to that clinic: another clinic's
    // code read as free and the insert died on P2002 (audit AP-15). Only the
    // id comes back, never the other clinic's row.
    const existing = await runUnscoped(
      "ticket code uniqueness is global across clinics",
      () =>
        prisma.appointment.findUnique({
          where: { ticketCode: code },
          select: { id: true },
        }),
    );
    if (!existing) return code;
  }
  // After 8 attempts in a 6.6·10¹¹-combination space we're either incredibly
  // unlucky or something is wrong with the RNG. Fail loud rather than insert
  // a duplicate and hit P2002 inside the booking tx.
  throw new Error("ticket_code_exhausted");
}

/**
 * Human-readable ticket code generator for Appointment.
 *
 * Crockford-style base32 alphabet — 30 chars, no visually ambiguous letters
 * (`0`, `1`, `I`, `L`, `O`, `U` omitted) so a patient can read the code off a
 * receipt and dictate it on the phone without "is that an O or a zero?".
 *
 * 6 chars → 30^6 ≈ 729M combinations; collisions are astronomically unlikely
 * for a single clinic. Generation is pre-tx (one `findUnique` check); if the
 * unique index still rejects on insert (extreme race), the booking surfaces
 * the standard P2002 error which the caller retries.
 */
import { prisma } from "@/lib/prisma";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 8;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
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
    const code = randomCode();
    const existing = await prisma.appointment.findUnique({
      where: { ticketCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // After 8 attempts in a 729M-combination space we're either incredibly
  // unlucky or something is wrong with the RNG. Fail loud rather than insert
  // a duplicate and hit P2002 inside the booking tx.
  throw new Error("ticket_code_exhausted");
}

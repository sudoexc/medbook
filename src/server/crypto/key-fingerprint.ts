/**
 * Short, non-reversible label of an encryption key (audit G2-11), printed by
 * the backfill scripts so two runs (the worker container and a laptop, say)
 * can be told apart by eye. Twelve hex characters of a domain-separated
 * SHA-256: nothing about the 256-bit key can be recovered from it.
 */
import { createHash } from "node:crypto";

export function keyFingerprint(key: Buffer): string {
  return createHash("sha256")
    .update("medbook-key-fingerprint:")
    .update(key)
    .digest("hex")
    .slice(0, 12);
}

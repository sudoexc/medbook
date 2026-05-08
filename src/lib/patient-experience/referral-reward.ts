/**
 * Phase 16 Wave 3 — Pure helpers for the refer-a-friend reward flow.
 *
 * Two responsibilities:
 *   1. Generate a short, human-readable referral code (8 chars, A-Z + 2-9 to
 *      avoid the 0/O 1/I/L confusion). Globally unique check is the caller's
 *      job — `generateReferralCode` is just the random-string primitive.
 *   2. Compute the discount tiins to apply to a fresh booking, given a
 *      pending `ReferralReward` snapshot and the booking's `priceFinal`.
 */

const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERRAL_CODE_LENGTH = 8;

/**
 * Generate a fresh 8-character referral code. Uses crypto.getRandomValues
 * if available (browser + Node 18+), with a Math.random fallback for tests
 * that mock out globalThis.crypto.
 */
export function generateReferralCode(): string {
  const len = REFERRAL_CODE_LENGTH;
  const out = new Array<string>(len);
  const buf = new Uint32Array(len);
  let filled = false;
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.crypto?.getRandomValues === "function"
    ) {
      globalThis.crypto.getRandomValues(buf);
      filled = true;
    }
  } catch {
    filled = false;
  }
  for (let i = 0; i < len; i += 1) {
    const r = filled ? buf[i]! : Math.floor(Math.random() * 0xffffffff);
    out[i] = REFERRAL_CODE_ALPHABET[r % REFERRAL_CODE_ALPHABET.length]!;
  }
  return out.join("");
}

/**
 * Given a pending reward and a booking price (tiins), return the discount in
 * tiins and the post-discount price. Caller subtracts the discount from
 * `priceFinal` and writes the audit trail.
 *
 * Edge cases:
 *   - rewardPercent <= 0  → zero discount (caller should keep reward PENDING).
 *   - priceFinal    <= 0  → zero discount (free booking — no reward to apply).
 *   - rewardPercent > 50  → clamped to 50% (defensive — schema enforces 0..50
 *     but a stale row could exist).
 */
export function computeReferralReward(params: {
  rewardPercent: number;
  priceFinalTiins: number;
}): { discountTiins: number; priceAfterTiins: number } {
  const pct = Math.max(0, Math.min(50, Math.floor(params.rewardPercent)));
  const price = Math.max(0, Math.floor(params.priceFinalTiins));
  if (pct === 0 || price === 0) {
    return { discountTiins: 0, priceAfterTiins: price };
  }
  // Round to nearest tiin. Tiins are already minor units (UZS × 100) so the
  // result is precise enough for invoicing.
  const discount = Math.round((price * pct) / 100);
  return {
    discountTiins: discount,
    priceAfterTiins: Math.max(0, price - discount),
  };
}

/**
 * Default reward expiry — 365 days from issue. Spec says "year-long discount
 * window" so the referrer doesn't lose the reward by going dormant. Caller
 * stamps the result into `ReferralReward.expiresAt`.
 */
export function defaultRewardExpiry(now: Date = new Date()): Date {
  const out = new Date(now.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + 1);
  return out;
}

/**
 * What the Telegram invite dialog shows for a POST
 * /api/crm/patients/[id]/telegram-invite response.
 *
 * Pure so the 409 branch is pinned by a test (audit PT-22): the route
 * answers a card that is already linked with `conflict("already_linked")`,
 * which puts the reason under `reason` and `error: "conflict"` on top
 * (src/server/http.ts). The dialog compared `body.error` with
 * "already_linked", so the branch never ran and reception read a bare
 * «conflict» instead of «already linked as @username».
 */

export type MintSuccess = {
  url: string;
  token: string;
  expiresAt: string;
  botUsername: string;
  isFreshlyMinted: boolean;
};

export type MintResult =
  | { kind: "ok"; data: MintSuccess }
  | {
      kind: "already_linked";
      telegramId: string;
      telegramUsername: string | null;
    }
  | { kind: "bot_not_configured" }
  | { kind: "error"; message: string };

export function mintResultFromResponse(
  status: number,
  body: unknown,
): MintResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  if (status === 409 && b.reason === "already_linked") {
    return {
      kind: "already_linked",
      telegramId: typeof b.telegramId === "string" ? b.telegramId : "",
      telegramUsername:
        typeof b.telegramUsername === "string" ? b.telegramUsername : null,
    };
  }
  if (status === 412 && b.error === "bot_not_configured") {
    return { kind: "bot_not_configured" };
  }
  if (status < 200 || status >= 300) {
    const message =
      (typeof b.error === "string" && b.error) || `HTTP ${status}`;
    return { kind: "error", message };
  }
  return { kind: "ok", data: b as unknown as MintSuccess };
}

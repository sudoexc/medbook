/**
 * What «Отвязать чат от карты» tells the operator when the API says no
 * (audit G6-14 review). Pure, so the mapping is tested without the page;
 * the keys live under `tgInbox.rail.unlink`.
 *   - cardOwnsTelegram: the card holds the chat's account by an invite, the
 *     Mini App or a shared contact; untied, the chat would come straight
 *     back with the next message, so the server keeps it.
 *   - roleRequired: the account was bound on staff confirmation, and only
 *     the roles that confirm may take it off the card.
 */
export type UnlinkErrorKey = "cardOwnsTelegram" | "roleRequired" | "failed";

export function unlinkErrorKey(status: number, body: unknown): UnlinkErrorKey {
  const reason =
    body && typeof body === "object" ? (body as { reason?: unknown }).reason : undefined;
  if (status === 409 && reason === "card_owns_telegram") return "cardOwnsTelegram";
  if (status === 403 && reason === "telegram_link_role") return "roleRequired";
  return "failed";
}

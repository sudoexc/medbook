/**
 * Facts every path that (re)points a clinic's bot at us must agree on: the
 * connect wizard (`/api/crm/integrations/tg/connect`) and the token swap in
 * the clinic settings (`/api/crm/clinic/secrets`, audit ST-02).
 */

/**
 * BotFather token shape: numeric bot id, colon, secret part; 20 to 80 chars
 * in all, the same bounds the connect wizard's schema applies.
 */
export function isTelegramTokenShape(token: string): boolean {
  return (
    token.length >= 20 &&
    token.length <= 80 &&
    /^\d+:[A-Za-z0-9_-]+$/.test(token)
  );
}

/** The updates the webhook handles; anything else is not subscribed to. */
export const TG_ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "my_chat_member",
] as const;

/**
 * The public origin Telegram must reach: $NEXT_PUBLIC_APP_URL when set (the
 * app sits behind nginx, the request URL may be internal), else the request.
 */
export function telegramPublicOrigin(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

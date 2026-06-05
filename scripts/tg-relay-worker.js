/**
 * Cloudflare Worker — Telegram Bot API relay.
 *
 * Uzbekistan ISPs block the 149.154.0.0/16 range that hosts api.telegram.org,
 * so the medbook VPS can't reach Telegram directly. This worker is a thin
 * pass-through proxy: requests to `https://<this-worker>.workers.dev/...`
 * are forwarded 1:1 to `https://api.telegram.org/...` and the response
 * (status, headers, body) is returned unchanged.
 *
 * The relay is token-agnostic — the bot token lives in the path
 * (`/bot<TOKEN>/sendMessage`) exactly like the canonical endpoint, so a
 * single worker serves every clinic's bot.
 *
 * Deployment:
 *   1. Cloudflare dashboard → Workers & Pages → Create → "Hello World"
 *   2. Replace template code with this file's contents
 *   3. Deploy. Copy the *.workers.dev URL (e.g. https://medbook-tg.<acc>.workers.dev).
 *   4. Set `TELEGRAM_API_BASE=<that URL>` in the VPS .env, restart worker/app.
 *
 * Or via wrangler:
 *   wrangler init medbook-tg --type javascript
 *   cp scripts/tg-relay-worker.js src/worker.js
 *   wrangler deploy
 */

const TG_ORIGIN = "https://api.telegram.org";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, TG_ORIGIN);

    // Block obviously bad paths early — Telegram bot tokens start with
    // digits followed by ":". Anything else is probably a scanner.
    if (!incoming.pathname.match(/^\/(bot\d+:|file\/bot\d+:)/)) {
      return new Response("Not Found", { status: 404 });
    }

    // Strip Cloudflare hop-by-hop headers Telegram doesn't expect. fetch()
    // will re-add Host based on `upstream`.
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("host");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");

    const init = {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    };

    const upstreamRes = await fetch(upstream.toString(), init);

    // Pass-through the response. Telegram's JSON body + status code is what
    // the medbook client parses, so we don't transform anything.
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
  },
};

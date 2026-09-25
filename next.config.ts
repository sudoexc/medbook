import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CSP notes:
//  - `script-src 'unsafe-inline'` is required for JSON-LD inline scripts and
//    Next.js framework hydration. A full nonce strategy would need per-request
//    header plumbing via proxy.ts; tracked as follow-up.
//  - `https://telegram.org` is allowed under script-src so the Mini App can
//    load `telegram-web-app.js` — the SDK that bridges the WebView to the
//    Telegram client and populates `window.Telegram.WebApp` with the
//    real init-data. Without it, the Mini App falls through to the
//    "Open in Telegram" guard even when launched inside Telegram.
//  - Image sources include api.qrserver.com for the /ticket QR fallback.
//  - Telegram API is allowed for server-side fetches (fine) and is listed under
//    connect-src defensively in case client code ever needs it.
//  - Yandex Metrika (public site only, see components/analytics) needs its
//    tag, beacon and session-replay hosts. Its click map and replay player
//    frame the page from metrika.yandex.*, so the public pages (and only
//    those) relax frame-ancestors — the CRM stays unframeable.
const isDev = process.env.NODE_ENV !== "production";

const METRIKA = "https://mc.yandex.ru https://mc.yandex.com https://mc.yandex.uz";
const METRIKA_FRAMERS =
  "https://metrika.yandex.ru https://metrika.yandex.com https://metrika.yandex.uz https://webvisor.com https://*.webvisor.com";

const buildCsp = (frameAncestors: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' https://telegram.org ${METRIKA} https://yastatic.net${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://api.qrserver.com ${METRIKA}`,
    "font-src 'self' data:",
    `connect-src 'self' https://api.telegram.org ${METRIKA} wss://mc.yandex.ru wss://mc.yandex.com`,
    // The landing embeds the clinic's Yandex Maps org widget (keyless iframe).
    `frame-src 'self' blob: https://yandex.uz https://yandex.ru https://yandex.com ${METRIKA}`,
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

const contentSecurityPolicy = buildCsp("'self'");
const siteContentSecurityPolicy = buildCsp(`'self' ${METRIKA_FRAMERS}`);

// Routes that stream user-uploaded files set their OWN Content-Security-
// Policy (a sandbox for anything that is not a PDF — src/server/storage/
// safe-file.ts). A config header with the same key would replace it, so the
// app-wide CSP skips exactly these paths (audit CD-01).
const USER_FILE_ROUTES =
  "api/crm/documents/file$|api/miniapp/documents/[^/]+/file$|api/crm/conversations/[^/]+/attachments/file$";

// Public landing routes (ru at the root, uz under /uz — localePrefix
// "as-needed"). Listed after the catch-all so their CSP wins.
const SITE_PATHS = [
  "/",
  "/uz",
  "/doctors/:path*",
  "/uz/doctors/:path*",
  "/privacy",
  "/uz/privacy",
  "/terms",
  "/uz/terms",
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // `output: 'standalone'` makes `next build` emit a self-contained server
  // bundle under `.next/standalone` that only needs Node.js at runtime. We
  // deploy that via Docker (see Dockerfile) — no `node_modules/` in the
  // final image. See `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.
  output: "standalone",
  // CI/CD runs tsc --noEmit + vitest as separate gates. next build's bundled
  // typecheck duplicates that work and produces platform-divergent results
  // when the Prisma client type union is collapsed under different generated
  // outputs (Linux engine vs darwin) — fail-loud locally, fail-blind in
  // Docker. We trust the standalone gates instead.
  typescript: { ignoreBuildErrors: true },
  // Hide the Next.js dev tools indicator ("N" pill in the corner) — it
  // overlaps the Telegram Mini App's FAB area and confuses clients testing
  // the bot. Build/runtime errors still surface in the console.
  devIndicators: false,
  // Allow dev-mode cross-origin loads from the public tunnel hosts we use
  // for Telegram bot/Mini-App testing (cloudflared quick tunnels, ngrok).
  // Without this, Next 16 dev blocks HMR + static chunks when the app is
  // opened via the tunnel URL.
  ...(isDev
    ? {
        allowedDevOrigins: [
          "*.trycloudflare.com",
          "*.ngrok-free.app",
          "*.lhr.life",
        ],
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: `/:path((?!${USER_FILE_ROUTES}).*)`,
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
      ...SITE_PATHS.map((source) => ({
        source,
        headers: [
          { key: "Content-Security-Policy", value: siteContentSecurityPolicy },
        ],
      })),
    ];
  },
};

export default withNextIntl(nextConfig);

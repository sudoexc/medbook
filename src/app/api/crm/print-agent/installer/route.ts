/**
 * GET /api/crm/print-agent/installer?printer=192.168.68.50 — the clinic's
 * admin downloads a one-time installer (.bat) for the reception PC: it
 * puts the print agent in place with a fresh token (the clinic's earlier
 * agent stops) and starts it at every sign-in (src/server/print/agent-script.ts).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { SITE_DOMAIN } from "@/lib/constants";
import { err } from "@/server/http";
import { mintPrintAgent } from "@/server/print/agent";
import { installerBat } from "@/server/print/agent-script";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "SUPER_ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const url = new URL(request.url);
    const printer = url.searchParams.get("printer")?.trim() ?? "";
    if (!IPV4.test(printer)) return err("BadRequest", 400, { reason: "printer_ip" });
    const token = await mintPrintAgent({ clinicId: ctx.clinicId, printerHost: printer });
    // The public address, never the request's: behind nginx the app sees
    // itself as http://0.0.0.0:3000, which the first installer wrote into
    // the PC's config (09.10.2026).
    const server = (process.env.NEXT_PUBLIC_BASE_URL ?? `https://${SITE_DOMAIN}`).replace(/\/+$/, "");
    return new Response(installerBat({ server, token }), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="neurofax-print-install.bat"',
        "Cache-Control": "no-store",
      },
    });
  },
);

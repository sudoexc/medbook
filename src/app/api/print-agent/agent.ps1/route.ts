/**
 * GET /api/print-agent/agent.ps1 — the print agent script (no secrets in
 * it; the token stays in agent.conf on the PC). Fetched by the installer
 * and on every start, so a deploy updates the agent.
 */
import { AGENT_SCRIPT } from "@/server/print/agent-script";

export const dynamic = "force-static";

export function GET() {
  return new Response(AGENT_SCRIPT, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

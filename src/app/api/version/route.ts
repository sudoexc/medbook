/**
 * GET /api/version — `{ build }`: the id of the build this server runs
 * (.next/BUILD_ID). Open pages compare it with the build they loaded and
 * reload themselves after a deploy (src/components/version-watch.tsx).
 * Public and harmless: nothing but an opaque id.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

let cached: string | null = null;

function buildId(): string {
  if (cached) return cached;
  try {
    cached = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || "dev";
  } catch {
    cached = "dev";
  }
  return cached;
}

export function GET() {
  return Response.json({ build: buildId() }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Audit INF-07: nginx proxied the whole MinIO root at https://neurofax.uz/files/
 * (S3 API for every bucket, the admin API, health probes) behind one root key
 * pair that docker-compose defaulted to values printed in the repository, with
 * no rate limit. The app had stopped using the path: presigned URLs broke on
 * the prefix rewrite and every file is streamed through app routes instead.
 *
 * Pinned here: the repo nginx config exposes no MinIO location; no code
 * issues presigned (browser-facing) MinIO URLs; compose has no default
 * credentials; the one surface that still rendered a stored bucket URL raw
 * (the Mini App header logo) no longer does.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ logoUrl: null as string | null }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async () => ({
        id: "c1",
        slug: "neurofax",
        nameRu: "NeuroFax",
        active: true,
        logoUrl: h.logoUrl,
      })),
    },
  },
}));

import { GET as miniAppClinic } from "@/app/api/miniapp/clinic/route";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("MinIO is not reachable from the internet", () => {
  it("nginx has no /files/ location and no MinIO upstream", () => {
    // Directives only: the comment explaining the removal names the path.
    const conf = read("nginx/nginx.conf")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(conf).not.toMatch(/location\s+\/files\//);
    expect(conf).not.toMatch(/proxy_pass\s+http:\/\/medbook_minio/);
    expect(conf).not.toMatch(/server\s+minio:9000/);
    // The shared vhosts must keep working: the include stays.
    expect(conf).toMatch(/include \/etc\/nginx\/conf\.d\/\*\.conf;/);
  });

  it("no code hands a browser a presigned MinIO URL", () => {
    const offenders = walk(path.join(root, "src"))
      .filter((f) => !f.endsWith(path.join("server", "storage", "minio.ts")))
      .filter((f) => /\bgetSigned(Upload)?Url\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("compose starts MinIO only with credentials from .env", () => {
    const compose = read("docker-compose.yml");
    expect(compose).not.toMatch(/MINIO_ACCESS_KEY:-/);
    expect(compose).not.toMatch(/MINIO_SECRET_KEY:-/);
    expect(compose).toMatch(/MINIO_ROOT_USER: \$\{MINIO_ACCESS_KEY:\?/);
    expect(compose).toMatch(/MINIO_ROOT_PASSWORD: \$\{MINIO_SECRET_KEY:\?/);
  });
});

describe("Mini App clinic header logo", () => {
  const get = () =>
    miniAppClinic(new Request("https://neurofax.uz/api/miniapp/clinic?clinicSlug=neurofax"));

  it("drops a stored bucket URL instead of rendering a broken /files/ image", async () => {
    for (const stored of [
      "https://neurofax.uz/files/medbook/branding/c1/logo.png",
      "https://files.neurofax.uz/medbook/branding/c1/logo.png",
    ]) {
      h.logoUrl = stored;
      const body = (await (await get()).json()) as { clinic: { logoUrl: string | null } };
      expect(body.clinic.logoUrl).toBeNull();
    }
  });

  it("keeps an external https logo and a missing one as they are", async () => {
    h.logoUrl = "https://cdn.example.org/neurofax.png";
    let body = (await (await get()).json()) as { clinic: { logoUrl: string | null } };
    expect(body.clinic.logoUrl).toBe("https://cdn.example.org/neurofax.png");
    h.logoUrl = null;
    body = (await (await get()).json()) as { clinic: { logoUrl: string | null } };
    expect(body.clinic.logoUrl).toBeNull();
  });
});

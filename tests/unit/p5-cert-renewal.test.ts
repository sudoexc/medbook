/**
 * Audit INF-03 — a renewed certificate reaches nginx without a deploy.
 *
 * The certbot sidecar renewed files, but nothing reloaded nginx, which kept
 * serving the old certificate from memory: a month without a deploy meant a
 * TLS outage for the clinic and every neighbour behind this nginx. Now a
 * certbot deploy hook leaves a flag in the shared volume, a host cron reloads
 * nginx (gated on `nginx -t`) and clears it, and the watchdog warns about a
 * served certificate that expires within 14 days.
 */
import { statSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const FLAG = "/etc/letsencrypt/.nginx-reload-requested";

describe("certbot asks for the reload", () => {
  it("the hook is mounted where certbot runs it after every renewal (loop and manual renew)", () => {
    const compose = read("docker-compose.yml");
    const certbot = compose.slice(compose.indexOf("  certbot:"), compose.indexOf("volumes:\n  pgdata"));
    expect(certbot).toContain(
      "./ops/certbot/request-nginx-reload.sh:/etc/letsencrypt/renewal-hooks/deploy/medbook-request-nginx-reload.sh:ro",
    );
    // The promise in the old comment is gone; the mechanism is described.
    expect(certbot).not.toContain("reload nginx on success");
  });

  it("the hook only drops the flag in the shared letsencrypt volume, and is executable", () => {
    const hook = read("ops/certbot/request-nginx-reload.sh");
    expect(hook.startsWith("#!/bin/sh")).toBe(true);
    expect(hook).toContain(`FLAG=${FLAG}`);
    expect(hook).toContain('> "$FLAG"');
    expect(statSync(path.join(process.cwd(), "ops/certbot/request-nginx-reload.sh")).mode & 0o111).not.toBe(0);
  });

  it("nginx mounts the same volume, so the host can see the flag through it", () => {
    const compose = read("docker-compose.yml");
    const nginx = compose.slice(compose.indexOf("  nginx:"), compose.indexOf("  certbot:"));
    expect(nginx).toContain("letsencrypt:/etc/letsencrypt");
  });
});

describe("the host reloads nginx", () => {
  const script = read("ops/nginx-reload-on-renew.sh");

  it("does nothing without the flag", () => {
    expect(script).toContain(`FLAG=${FLAG}`);
    expect(script).toMatch(/if ! docker compose exec -T nginx test -f "\$FLAG"; then\s+exit 0/);
  });

  it("tests the config before a graceful reload, and clears the flag only after it", () => {
    const test = script.indexOf("nginx nginx -t");
    const reload = script.indexOf("nginx nginx -s reload");
    const clear = script.indexOf('rm -f "$FLAG"');
    expect(test).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(test);
    expect(clear).toBeGreaterThan(reload);
    // A restart would blip every neighbour; only a reload is used.
    expect(script).not.toMatch(/compose (restart|up)/);
  });

  it("is executable and scheduled in the recommended crontab", () => {
    expect(statSync(path.join(process.cwd(), "ops/nginx-reload-on-renew.sh")).mode & 0o111).not.toBe(0);
    expect(read("ops/crontab.example")).toMatch(
      /^\d+ \* \* \* \* cd \/opt\/neurofax && \.\/ops\/nginx-reload-on-renew\.sh/m,
    );
  });
});

describe("the watchdog warns before a certificate expires", () => {
  it("checks the certificate nginx serves, 14 days ahead", () => {
    const wd = read("ops/watchdog.sh");
    expect(wd).toContain('WATCHDOG_CERT_MIN_DAYS:=14');
    expect(wd).toContain("openssl s_client -connect");
    expect(wd).toContain("-checkend $(( WATCHDOG_CERT_MIN_DAYS * 86400 ))");
    expect(wd).toContain("CERT=$(cert_problems)");
  });
});

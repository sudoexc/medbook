# Custom subdomain provisioning runbook

Phase 19 Wave 4 — Pro / Enterprise white-label feature.

The `/crm/settings/branding` form lets a clinic admin pick a label
(`my-clinic`) that becomes `my-clinic.neurofax.uz`. The label is stored in
`Clinic.customSubdomain` and surfaced to patients in onboarding emails / TG
messages, but **DNS + TLS provisioning is manual**: the clinic admin
saves the label, then we (platform ops) flip the routing.

This runbook is the checklist platform ops follows to provision the
subdomain. Skipping any step leaves the patient surface returning a 404
or, worse, mis-routed traffic to the wrong tenant.

## Prerequisites

- SUPER_ADMIN access to the platform.
- SSH access to `root@5.129.242.246` (the medbook VPS).
- Access to the DNS zone for `neurofax.uz` (Cloudflare). The credentials
  live in 1Password under `infra/cloudflare-neurofax-uz`.

## Steps

### 1. Verify the request

1. Open `/admin/clinics`, locate the row, confirm the plan is **Pro** or
   **Enterprise** (otherwise the field would have been disabled).
2. Open the clinic's audit feed, locate the most recent
   `BRANDING_CHANGED` row whose `meta.changed` array contains
   `customSubdomain`. Note the value and the timestamp.
3. Check that the value is not on the platform-wide reserved list (see
   `RESERVED_SUBDOMAINS` in `src/server/platform/subdomain.ts`). The form
   already rejects reserved names, but a hand-edit via psql could bypass it.

### 2. Cloudflare — add the CNAME

1. Cloudflare → `neurofax.uz` zone → DNS → Records.
2. Add: `CNAME` `<sub>` → `app.neurofax.uz` (the apex Vercel/VPS
   target). Proxied: **off** (so the wildcard cert covers it without
   Cloudflare's edge re-encrypting).
3. TTL: Auto.

### 3. nginx — add the host rule

On the medbook VPS:

```bash
ssh root@5.129.242.246
cd /etc/nginx/sites-available
cp medbook.conf medbook.conf.bak.$(date +%F)
```

Edit `medbook.conf`. Inside the `server { listen 443 ssl; ... }` block,
add the new label to the `server_name` directive:

```nginx
server_name neurofax.uz www.neurofax.uz <sub>.neurofax.uz;
```

Save, then:

```bash
nginx -t && systemctl reload nginx
```

If `nginx -t` complains, restore the backup and stop here.

### 4. TLS — verify the wildcard cert covers the label

We use a Let's Encrypt wildcard for `*.neurofax.uz`. Verify:

```bash
echo | openssl s_client -connect <sub>.neurofax.uz:443 -servername <sub>.neurofax.uz 2>/dev/null | openssl x509 -noout -subject -issuer
```

The subject should include `CN = *.neurofax.uz`. If the cert is missing
that wildcard SAN, run:

```bash
certbot renew --cert-name neurofax.uz --force-renewal
```

### 5. Application — verify the resolver picks the row up

The middleware (`src/middleware.ts`) reads the `Host` header. When a
request arrives for `<sub>.neurofax.uz`, it should resolve to the same
clinic as `/c/<slug>/my`. Quick smoke test:

```bash
curl -i -H "Host: <sub>.neurofax.uz" https://app.neurofax.uz/
```

Expected: HTTP 200 + the clinic-branded mini-app shell. If you get a 404
or a default landing page, the middleware host-resolver did not pick the
row up — check `Clinic.customSubdomain` in psql and re-run.

### 6. Notify the clinic admin

Reply on the support thread with:

- The new URL (`https://<sub>.neurofax.uz/`).
- A reminder that DNS propagation may take up to 5 minutes worldwide.
- A pointer to `/crm/settings/branding` if they want to change colours
  or logo (those changes are instant and don't need ops involvement).

## Rollback

If the clinic asks to remove the subdomain:

1. Clear `Clinic.customSubdomain` in `/crm/settings/branding` (sets it to
   null and audits `BRANDING_CHANGED`).
2. Remove the label from the nginx `server_name` line and reload.
3. Delete the CNAME record from Cloudflare.

Order matters: clear the DB first so any in-flight requests fail fast
into the regular `/c/<slug>/my` route instead of returning 404 from
nginx.

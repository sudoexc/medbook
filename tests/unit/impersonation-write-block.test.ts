/**
 * Phase 19 Wave 4 — VIEW_ONLY write-block helpers.
 *
 * Covers the pure parts of the createApiHandler enforcement: the safe-method
 * / skip-path matrix from `isViewOnlySafe`, and the shape of the 403 the
 * wrapper returns. The full request flow (auth → ctx → block) is exercised
 * by the integration suite; this test pins the contract that the API
 * client + tests rely on.
 */
import { describe, it, expect } from "vitest";

import { isViewOnlySafe, viewOnlyBlockResponse } from "@/lib/view-only";

function req(method: string, path: string): Request {
  return new Request(`https://app.example/${path.replace(/^\//, "")}`, {
    method,
  });
}

describe("isViewOnlySafe", () => {
  it.each(["GET", "HEAD", "OPTIONS"])(
    "treats %s as safe regardless of path",
    (method) => {
      expect(isViewOnlySafe(req(method, "/api/crm/patients"))).toBe(true);
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "treats %s as unsafe by default",
    (method) => {
      expect(isViewOnlySafe(req(method, "/api/crm/patients"))).toBe(false);
    },
  );

  it("allows POST on /api/platform/session/* so SUPER_ADMIN can always exit", () => {
    expect(
      isViewOnlySafe(req("POST", "/api/platform/session/switch-clinic")),
    ).toBe(true);
  });

  it("blocks POST on other /api/platform/* paths", () => {
    expect(isViewOnlySafe(req("POST", "/api/platform/clinics"))).toBe(false);
  });

  it("is case-insensitive on the method", () => {
    expect(isViewOnlySafe(req("get", "/api/crm/patients"))).toBe(true);
    expect(isViewOnlySafe(req("post", "/api/crm/patients"))).toBe(false);
  });
});

describe("viewOnlyBlockResponse", () => {
  it("returns a 403 with the documented body shape", async () => {
    const res = viewOnlyBlockResponse("grant_abc");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "ViewAsReadOnly", grantId: "grant_abc" });
  });
});

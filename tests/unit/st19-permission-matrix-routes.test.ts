/**
 * Audit ST-19: the «Роли и права» screen against the routes.
 *
 * The screen promised limits the API never had (nurses saw "today only",
 * doctors "own cases only") under a subtitle saying it showed the
 * implementation. Each cell's "can this role do it at all" is checked here
 * against the `roles` of the handlers that serve it, read from the route
 * sources, so the matrix cannot drift from the code silently again.
 * SUPER_ADMIN passes every role check (`allowSuperAdmin`), so its cell must
 * say yes exactly where a handler exists.
 *
 * Scopes narrower than "all" ('own') are not visible in the role lists;
 * each is backed by a check in the handler and pinned by its own tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CALL_CENTER_ROLES } from "@/lib/calls/roles";
import { ONLINE_REQUEST_ROLES } from "@/server/schemas/online-request";
import {
  ALL_ROLES,
  PERMISSION_MATRIX,
  type ResourceKey,
  type Role,
} from "@/lib/permissions/matrix";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

const API = path.join(process.cwd(), "src/app/api/crm");

/** Role lists routes spread in (`roles: [...CALL_CENTER_ROLES]`). */
const SHARED_ROLE_LISTS: Record<string, readonly string[]> = {
  CALL_CENTER_ROLES,
  ONLINE_REQUEST_ROLES,
};

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Roles per exported handler; a handler without `roles` (a 405 stub) has none. */
function handlerRoles(file: string): Partial<Record<Method | "PUT", string[]>> {
  const src = readFileSync(path.join(API, file), "utf8");
  const out: Partial<Record<Method | "PUT", string[]>> = {};
  const handlers = src.matchAll(
    /export const (GET|POST|PATCH|PUT|DELETE)\s*=([\s\S]*?)(?=\nexport |$)/g,
  );
  for (const [, method, body] of handlers) {
    const list = /roles:\s*\[([^\]]*)\]/.exec(body!)?.[1];
    const roles: string[] = [];
    for (const item of (list ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const literal = /^"([A-Z_]+)"$/.exec(item);
      const spread = /^\.\.\.([A-Z_]+)$/.exec(item);
      if (literal) roles.push(literal[1]!);
      else if (spread && SHARED_ROLE_LISTS[spread[1]!]) {
        roles.push(...SHARED_ROLE_LISTS[spread[1]!]!);
      } else throw new Error(`${file}: cannot read role list item ${item}`);
    }
    out[method as Method] = roles;
  }
  return out;
}

/** The handlers behind each action of each resource row. */
const ROUTES: Record<ResourceKey, Record<Method, string[]>> = {
  Patient: {
    GET: ["patients/route.ts"],
    POST: ["patients/route.ts"],
    PATCH: ["patients/[id]/route.ts"],
    DELETE: ["patients/[id]/route.ts"],
  },
  Appointment: {
    GET: ["appointments/route.ts"],
    POST: ["appointments/route.ts", "appointments/walkin/route.ts"],
    PATCH: ["appointments/[id]/route.ts", "appointments/[id]/queue-status/route.ts"],
    DELETE: ["appointments/[id]/route.ts"],
  },
  Doctor: {
    GET: ["doctors/route.ts"],
    POST: ["doctors/route.ts"],
    PATCH: ["doctors/[id]/route.ts"],
    DELETE: ["doctors/[id]/route.ts"],
  },
  Cabinet: {
    GET: ["cabinets/route.ts"],
    POST: ["cabinets/route.ts"],
    PATCH: ["cabinets/[id]/route.ts"],
    DELETE: ["cabinets/[id]/route.ts"],
  },
  Service: {
    GET: ["services/route.ts"],
    POST: ["services/route.ts"],
    PATCH: ["services/[id]/route.ts"],
    DELETE: ["services/[id]/route.ts"],
  },
  Payment: {
    GET: ["payments/route.ts"],
    POST: ["payments/route.ts"],
    PATCH: ["payments/[id]/route.ts"],
    DELETE: ["payments/route.ts", "payments/[id]/route.ts"],
  },
  MedicalCase: {
    GET: ["cases/route.ts"],
    POST: ["cases/route.ts"],
    PATCH: ["cases/[id]/route.ts"],
    DELETE: ["cases/route.ts", "cases/[id]/route.ts"],
  },
  NotificationTemplate: {
    GET: ["notifications/templates/route.ts"],
    POST: ["notifications/templates/route.ts"],
    PATCH: ["notifications/templates/[id]/route.ts"],
    DELETE: ["notifications/templates/[id]/route.ts"],
  },
  Lead: {
    GET: ["online-requests/route.ts"],
    POST: ["online-requests/route.ts"],
    PATCH: ["online-requests/[id]/route.ts"],
    DELETE: ["online-requests/[id]/route.ts"],
  },
  Call: {
    GET: ["calls/route.ts"],
    POST: ["calls/route.ts"],
    PATCH: ["calls/[id]/route.ts"],
    DELETE: ["calls/[id]/route.ts"],
  },
  AuditLog: {
    GET: ["audit/route.ts"],
    POST: ["audit/route.ts"],
    PATCH: ["audit/route.ts"],
    DELETE: ["audit/route.ts"],
  },
  // The settings section: the users API stands for it (the clinic's own
  // fields are edited through PATCH /api/crm/clinic, ADMIN as well).
  Settings: {
    GET: ["users/route.ts"],
    POST: ["users/route.ts"],
    PATCH: ["users/[id]/route.ts", "clinic/route.ts"],
    DELETE: ["users/[id]/route.ts"],
  },
};

function allowed(resource: ResourceKey, method: Method, role: Role): boolean {
  return ROUTES[resource][method].some((file) => {
    const handlers = handlerRoles(file);
    const lists = [handlers[method], method === "PATCH" ? handlers.PUT : undefined];
    return lists.some((roles) =>
      roles === undefined ? false : role === "SUPER_ADMIN" ? roles.length > 0 : roles.includes(role),
    );
  });
}

describe("PERMISSION_MATRIX matches the route role lists", () => {
  it("covers every resource row", () => {
    expect(PERMISSION_MATRIX.map((r) => r.resource).sort()).toEqual(
      (Object.keys(ROUTES) as ResourceKey[]).sort(),
    );
  });

  for (const { resource, perRole } of PERMISSION_MATRIX) {
    for (const role of ALL_ROLES) {
      it(`${resource} × ${role}`, () => {
        const p = perRole[role];
        expect({
          read: p.read !== "none",
          write: p.write,
          update: p.update !== "none",
          delete: p.delete,
        }).toEqual({
          read: allowed(resource, "GET", role),
          write: allowed(resource, "POST", role),
          update: allowed(resource, "PATCH", role),
          delete: allowed(resource, "DELETE", role),
        });
      });
    }
  }

  it("promises no limit the routes do not have", () => {
    const cell = (resource: ResourceKey, role: Role) =>
      PERMISSION_MATRIX.find((r) => r.resource === resource)!.perRole[role];
    // GET /api/crm/appointments narrows only DOCTOR.
    expect(cell("Appointment", "NURSE").read).toBe("all");
    // GET /api/crm/cases and PATCH do not filter by doctor.
    expect(cell("MedicalCase", "DOCTOR")).toMatchObject({ read: "all", update: "all" });
    expect(PERMISSION_MATRIX.some((r) => Object.values(r.perRole).some((p) => p.read === "today"))).toBe(
      false,
    );
  });

  it("the screen no longer says it shows the implementation", () => {
    expect(ru.settings.roles.subtitle).not.toMatch(/реализаци/);
    expect(uz.settings.roles.subtitle).not.toMatch(/amalga oshirish/);
  });
});

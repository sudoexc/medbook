import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-01: a voice note or video now plays inside the CRM bubble from the
 * chat attachment proxy. Media elements ask for byte ranges to seek, and
 * Safari will not play media from a server that ignores them, so the proxy
 * answers `Range` with 206 + Content-Range and always says Accept-Ranges.
 */

const state = vi.hoisted(() => ({
  calls: [] as Array<{ key: string; range: string | null | undefined }>,
}));

vi.mock("@/server/storage/minio", async (orig) => {
  const real = await orig<typeof import("@/server/storage/minio")>();
  return {
    parseSingleByteRange: real.parseSingleByteRange,
    fetchObject: vi.fn(
      async (_b: unknown, key: string, opts?: { range?: string | null }) => {
        state.calls.push({ key, range: opts?.range });
        const total = 1000;
        if (opts?.range === "bytes=0-99") {
          return {
            body: new Response(new Uint8Array(100)).body,
            contentType: "audio/ogg",
            contentLength: 100,
            contentRange: `bytes 0-99/${total}`,
          };
        }
        return {
          body: new Response(new Uint8Array(total)).body,
          contentType: "audio/ogg",
          contentLength: total,
          contentRange: null,
        };
      },
    ),
  };
});

import { GET } from "@/app/api/crm/conversations/[id]/attachments/file/route";
import { parseSingleByteRange } from "@/server/storage/minio";

const url =
  "https://crm.test/api/crm/conversations/conv_1/attachments/file?key=clinics%2Fc1%2Fchat%2Fconv_1%2Fa.ogg&name=voice.ogg";

beforeEach(() => {
  state.calls = [];
});

describe("chat attachment proxy — byte ranges", () => {
  it("answers a Range request with 206 and the part asked for", async () => {
    const res = await GET(new Request(url, { headers: { range: "bytes=0-99" } }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("audio/ogg");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
  });

  it("serves the whole file with Accept-Ranges when no range is asked", async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(state.calls[0]!.range).toBeNull();
  });

  it("ignores a malformed or multi-part range", () => {
    expect(parseSingleByteRange("bytes=0-99")).toBe("bytes=0-99");
    expect(parseSingleByteRange("bytes=500-")).toBe("bytes=500-");
    expect(parseSingleByteRange("bytes=-200")).toBe("bytes=-200");
    expect(parseSingleByteRange("bytes=0-1,5-9")).toBeNull();
    expect(parseSingleByteRange("items=0-1")).toBeNull();
    expect(parseSingleByteRange("bytes=-")).toBeNull();
    expect(parseSingleByteRange(null)).toBeNull();
  });
});

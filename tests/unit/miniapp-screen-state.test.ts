/**
 * Mini App list screens must tell "нет записей" apart from "не смогли
 * проверить".
 *
 * The bug: documents / appointments handled only `isLoading` and then fell
 * through to `data?.length ? list : empty`. A dropped connection therefore
 * rendered the empty state, and patients read «у вас нет записей» as "the
 * clinic cancelled my appointment".
 */
import { describe, expect, it } from "vitest";

import { resolveScreenState } from "@/app/c/[slug]/my/_lib/screen-state";

describe("resolveScreenState", () => {
  it("shows the error state — never the empty state — on a failed fetch", () => {
    // The regression case: no data because the request failed.
    expect(
      resolveScreenState({ isLoading: false, isError: true, itemCount: 0 }),
    ).toBe("error");
    expect(
      resolveScreenState({
        isLoading: false,
        isError: true,
        itemCount: undefined,
      }),
    ).toBe("error");
    expect(
      resolveScreenState({ isLoading: false, isError: true, itemCount: null }),
    ).toBe("error");
  });

  it("still shows empty when the request genuinely succeeded with no rows", () => {
    expect(
      resolveScreenState({ isLoading: false, isError: false, itemCount: 0 }),
    ).toBe("empty");
  });

  it("shows the list when rows arrived", () => {
    expect(
      resolveScreenState({ isLoading: false, isError: false, itemCount: 3 }),
    ).toBe("list");
  });

  it("prefers loading over error so a retry doesn't flash the error block", () => {
    expect(
      resolveScreenState({ isLoading: true, isError: true, itemCount: 0 }),
    ).toBe("loading");
  });

  it("keeps showing the error even if a stale list is still cached", () => {
    // Refetch failed while old rows linger: claiming success would present
    // stale clinical data as current.
    expect(
      resolveScreenState({ isLoading: false, isError: true, itemCount: 5 }),
    ).toBe("error");
  });
});

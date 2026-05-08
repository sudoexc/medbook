import { describe, expect, it } from "vitest";
import {
  computeDiff,
  extractFromSource,
  flatten,
} from "../../scripts/i18n-check";

describe("i18n-check / flatten", () => {
  it("flattens nested objects with dot paths", () => {
    expect(flatten({ a: { b: { c: "x" }, d: "y" }, e: "z" })).toEqual({
      "a.b.c": "x",
      "a.d": "y",
      e: "z",
    });
  });

  it("returns empty for null/undefined", () => {
    expect(flatten(null)).toEqual({});
    expect(flatten(undefined)).toEqual({});
  });
});

describe("i18n-check / extractFromSource", () => {
  it("extracts literal key from useTranslations + t() call", () => {
    const src = `
      const t = useTranslations("docsLibrary");
      return <h1>{t("title")}</h1>;
    `;
    const { literalKeys, dynamicPrefixes } = extractFromSource(src);
    expect([...literalKeys]).toContain("docsLibrary.title");
    expect(dynamicPrefixes.size).toBe(0);
  });

  it("supports nested key paths", () => {
    const src = `
      const t = useTranslations("docsLibrary");
      return t("filters.search");
    `;
    const { literalKeys } = extractFromSource(src);
    expect([...literalKeys]).toContain("docsLibrary.filters.search");
  });

  it("captures dynamic prefix from template literal call", () => {
    const src = `
      const t = useTranslations("docsLibrary");
      return t(\`types.\${tp}\` as never);
    `;
    const { dynamicPrefixes } = extractFromSource(src);
    expect([...dynamicPrefixes]).toContain("docsLibrary.types.");
  });

  it("ignores pure dynamic keys (no literal prefix)", () => {
    const src = `
      const t = useTranslations("ns");
      return t(\`\${anything}\`);
    `;
    const { literalKeys, dynamicPrefixes } = extractFromSource(src);
    expect(literalKeys.size).toBe(0);
    expect(dynamicPrefixes.size).toBe(0);
  });

  it("attributes calls to the most-recent declaration of t (scope-by-position)", () => {
    const src = `
      const t = useTranslations("first");
      function A() { return t("a"); }
      const t2 = "noise";
      function B() {
        const t = useTranslations("second");
        return t("b");
      }
    `;
    const { literalKeys } = extractFromSource(src);
    expect(literalKeys.has("first.a")).toBe(true);
    expect(literalKeys.has("second.b")).toBe(true);
    // Should NOT cross-attribute:
    expect(literalKeys.has("second.a")).toBe(false);
    expect(literalKeys.has("first.b")).toBe(false);
  });

  it("treats dynamic-namespace useTranslations as a prefix wildcard", () => {
    const src = `
      const t = useTranslations(\`crmShell.topbar.sections.\${sectionKey}\`);
      return <h1>{t("title")} {t("subtitle")}</h1>;
    `;
    const { literalKeys, dynamicPrefixes } = extractFromSource(src);
    // Calls under a dynamic namespace are NOT promoted to literal keys.
    expect([...literalKeys]).not.toContain(
      "crmShell.topbar.sections.title",
    );
    expect([...dynamicPrefixes]).toEqual(
      expect.arrayContaining([
        "crmShell.topbar.sections.title",
        "crmShell.topbar.sections.subtitle",
      ]),
    );
  });

  it("skips calls inside a function whose param shadows the translator", () => {
    const src = `
      const t = useTranslations("outer");
      function StatusPill({ state, t }: { state: string; t: any }) {
        return t("inner");
      }
      const top = t("top");
    `;
    const { literalKeys } = extractFromSource(src);
    expect(literalKeys.has("outer.top")).toBe(true);
    // The shadowed param-call should not produce "outer.inner".
    expect(literalKeys.has("outer.inner")).toBe(false);
  });

  it("supports alternative translator var names (tFoo)", () => {
    const src = `
      const tFoo = useTranslations("foo");
      return tFoo("bar.baz");
    `;
    const { literalKeys } = extractFromSource(src);
    expect(literalKeys.has("foo.bar.baz")).toBe(true);
  });
});

describe("i18n-check / computeDiff", () => {
  const ruKeys = new Set(["a.x", "a.y", "b"]);
  const uzKeys = new Set(["a.x", "a.y", "b"]);

  it("flags literal references missing in either bundle", () => {
    const referenced = new Set(["a.x", "missing.one"]);
    const dynamicPrefixes = new Set<string>();
    const diff = computeDiff({ ruKeys, uzKeys, referenced, dynamicPrefixes });
    expect(diff.missingInRu).toEqual(["missing.one"]);
    expect(diff.missingInUz).toEqual(["missing.one"]);
  });

  it("does NOT flag bundle keys covered by a dynamic prefix as unused", () => {
    const referenced = new Set<string>();
    const dynamicPrefixes = new Set(["a."]);
    const diff = computeDiff({ ruKeys, uzKeys, referenced, dynamicPrefixes });
    expect(diff.unused).toEqual(["b"]); // a.* is covered by prefix
  });

  it("flags truly unused keys", () => {
    const referenced = new Set(["a.x"]);
    const dynamicPrefixes = new Set<string>();
    const diff = computeDiff({ ruKeys, uzKeys, referenced, dynamicPrefixes });
    expect(diff.unused.sort()).toEqual(["a.y", "b"]);
  });

  it("empty refs + empty dynamic = everything unused, nothing missing", () => {
    const diff = computeDiff({
      ruKeys,
      uzKeys,
      referenced: new Set(),
      dynamicPrefixes: new Set(),
    });
    expect(diff.missingInRu).toEqual([]);
    expect(diff.missingInUz).toEqual([]);
    expect(diff.unused.sort()).toEqual(["a.x", "a.y", "b"]);
  });
});

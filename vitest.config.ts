import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    clearMocks: true,
    // Unit tests mock `prisma` per-suite and don't stub `prisma.user`. With 2FA
    // enabled, `enforceTotpEnrollment` would call `prisma.user.findUnique` on
    // those bare mocks and crash. Prod/staging set this in `.env`; mirror it
    // here so the enrollment guard short-circuits the same way it does there.
    env: { DISABLE_2FA: "1" },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "src/lib/**",
        "src/server/**",
        "src/hooks/**",
      ],
      exclude: [
        "**/*.d.ts",
        "**/node_modules/**",
        "**/generated/**",
        "**/__tests__/**",
      ],
    },
  },
});

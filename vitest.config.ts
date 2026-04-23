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

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "app/api/**"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
      thresholds: {
        "lib/admin/**": { statements: 95, branches: 90, lines: 95 },
        "lib/seo/**":   { statements: 90, branches: 85, lines: 90 },
        "app/api/**":   { statements: 85, branches: 80, lines: 85 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Stub out server-only so tests can import Next.js server modules
      // without the package throwing (it's a compile-time guard, not a runtime need).
      "server-only": path.resolve(__dirname, "__mocks__/server-only.ts"),
    },
  },
});

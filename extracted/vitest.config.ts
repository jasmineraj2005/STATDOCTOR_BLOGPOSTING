import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
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
    },
  },
});

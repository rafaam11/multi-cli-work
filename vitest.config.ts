import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The same aliases the renderer build uses (electron.vite.config.ts). Type-only imports never
  // needed them here, but a value import from @shared does.
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/renderer/src/test/setup.ts"],
    clearMocks: true,
    exclude: [...configDefaults.exclude, "e2e/**", ".worktrees/**", "worktrees/**"],
  },
});

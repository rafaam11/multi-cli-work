import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/renderer/src/test/setup.ts"],
    clearMocks: true,
    exclude: [...configDefaults.exclude, "e2e/**", ".worktrees/**", "worktrees/**"],
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test-setup.ts", "src/main.tsx"],
      thresholds: {
        "src/hooks/useUpdateState.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/hooks/updateStateMachine.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/lib/relative-time.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/components/UpdateToast/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
        "src/components/CheckForUpdatesButton/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  },
});

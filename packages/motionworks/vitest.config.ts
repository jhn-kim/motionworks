import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared-node",
          environment: "node",
          globals: false,
          include: ["src/shared/**/*.test.ts", "src/node/**/*.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        test: {
          name: "browser",
          environment: "jsdom",
          globals: false,
          include: ["src/browser/**/*.test.ts", "src/browser/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});

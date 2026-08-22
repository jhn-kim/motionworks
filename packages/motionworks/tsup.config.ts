import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/shared/index.ts" },
    format: ["esm"],
    platform: "neutral",
    dts: true,
    clean: true,
    sourcemap: true,
    tsconfig: "tsconfig.build.json",
  },
  {
    entry: { react: "src/browser/react.ts" },
    format: ["esm"],
    platform: "browser",
    dts: true,
    clean: false,
    sourcemap: true,
    external: ["react", "react-dom"],
    banner: { js: '"use client";' },
    tsconfig: "tsconfig.build.json",
  },
  {
    entry: { browser: "src/browser/index.ts" },
    format: ["esm"],
    platform: "browser",
    dts: true,
    clean: false,
    sourcemap: true,
    external: ["react", "react-dom"],
    tsconfig: "tsconfig.build.json",
  },
  {
    entry: {
      node: "src/node/index.ts",
      cli: "src/node/cli.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: {
      entry: { node: "src/node/index.ts" },
    },
    clean: false,
    sourcemap: true,
    tsconfig: "tsconfig.build.json",
  },
]);

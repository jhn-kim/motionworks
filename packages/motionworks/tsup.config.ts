import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "motionworks.global": "src/browser/standalone.ts" },
    format: ["iife"],
    globalName: "MotionWorks",
    platform: "browser",
    target: "es2020",
    noExternal: [/.*/],
    define: { "process.env.NODE_ENV": '"development"' },
    minify: true,
    sourcemap: true,
    dts: false,
    clean: false,
    outExtension: () => ({ js: ".js" }),
    tsconfig: "tsconfig.build.json",
  },
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
    // Leave `process.env.NODE_ENV` literal (identity define overrides tsup's
    // dev default) so the *consumer's* bundler folds it — otherwise the dev
    // overlay's `IS_DEV` inlines to `true` at publish time and the "renders
    // nothing in production" guarantee is broken (P0-1).
    define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
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
    define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
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
    // `discover` loads TypeScript at runtime from the host project (every built
    // React + Framer/GSAP codebase has it). Never bundle the compiler — it
    // would add megabytes and defeat the package's zero-runtime-dep design.
    external: ["typescript"],
    dts: {
      entry: { node: "src/node/index.ts" },
    },
    clean: false,
    sourcemap: true,
    tsconfig: "tsconfig.build.json",
  },
]);

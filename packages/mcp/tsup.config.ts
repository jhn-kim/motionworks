import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: {
    entry: { index: "src/index.ts" },
  },
  clean: true,
  sourcemap: true,
  target: "node18",
  external: ["@motionworks/core"],
  // Match packages/core: tsconfig.json has composite:true for project refs;
  // tsup's DTS worker needs composite:false.
  tsconfig: "tsconfig.build.json",
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // tsconfig.json has composite:true for project refs; tsup's DTS worker needs composite:false.
  tsconfig: "tsconfig.build.json",
});

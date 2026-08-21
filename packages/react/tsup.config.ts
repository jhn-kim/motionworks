import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom", "@motionworks/core"],
  // tsconfig.json has composite:true for project refs; tsup's DTS worker needs composite:false.
  tsconfig: "tsconfig.build.json",
});

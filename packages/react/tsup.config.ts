import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom", "@motionworks/core"],
  // The entry bundles the provider + hook, both of which use client-only React
  // hooks (useState/useEffect/useRef). Without a "use client" directive, an App
  // Router consumer that imports MotionWorksProvider into a Server Component
  // (e.g. layout.tsx) hard-crashes the server render. esbuild strips top-of-file
  // directives when bundling, so inject it as a banner to guarantee it survives
  // on every emitted chunk (including the split overlay-renderer chunk).
  banner: { js: '"use client";' },
  // tsconfig.json has composite:true for project refs; tsup's DTS worker needs composite:false.
  tsconfig: "tsconfig.build.json",
});

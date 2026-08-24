import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards P0-1: the published react bundle must defer the dev/prod decision to
// the consumer's bundler by keeping a literal `process.env.NODE_ENV`. If our
// build ever inlines it again, `IS_DEV` becomes a hard-coded `true` and the
// overlay (plus daemon polling, observers, localStorage) runs in production.
// Uses the vitest root (the package dir) so it works under jsdom too.
const reactBundle = join(process.cwd(), "dist", "react.js");
const built = existsSync(reactBundle);

describe.runIf(built)("dist/react.js build output", () => {
  const source = built ? readFileSync(reactBundle, "utf8") : "";

  it("keeps process.env.NODE_ENV unreplaced for consumer folding", () => {
    expect(source).toContain("process.env.NODE_ENV");
  });

  it("never hard-codes IS_DEV to a truthy constant", () => {
    expect(source).not.toMatch(/IS_DEV\w*\s*=\s*(?:true|!0)\b/);
  });
});

describe.skipIf(built)("dist/react.js build output", () => {
  it.skip("skipped — run `npm run build` first to check the published bundle", () => {
    // Intentionally empty; the guard only applies to a built artifact.
  });
});

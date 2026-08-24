import { afterEach } from "vitest";

// Vitest defaults NODE_ENV to "test", which would make the hook and provider
// take their production no-op paths and hide browser integration failures.
process.env["NODE_ENV"] = "development";

// Uncommitted diffs are hydrated from localStorage when an OverlaySession is
// constructed, and applied-entry ids from sessionStorage. Both are persistent
// browser state that survives between tests in a file, so a manipulation in one
// test could hydrate into the next session and surface a spurious change (e.g.
// "commits a type correction without a value change" seeing a stray radius
// edit). It is timing-dependent — the 100 ms persist debounce racing the test
// boundary — so it only went red under CI's slower Node 20 scheduling. Clear
// both stores after every test so each starts from a clean slate. Guarded for
// the node project, which has no DOM storage.
afterEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
});

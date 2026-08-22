// Vitest defaults NODE_ENV to "test", which would make the hook and provider
// take their production no-op paths and hide browser integration failures.
process.env["NODE_ENV"] = "development";

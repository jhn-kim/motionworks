/**
 * Tiny dependency-free terminal styling for the `init` onboarding output.
 *
 * Color is enabled only for real interactive stdout (or when FORCE_COLOR is
 * set) and disabled under NO_COLOR / TERM=dumb, so piped output, CI logs, and
 * the PassThrough streams used in tests all stay plain text.
 */
const colorEnabled =
  process.env["NO_COLOR"] === undefined &&
  process.env["TERM"] !== "dumb" &&
  (process.env["FORCE_COLOR"] !== undefined || process.stdout.isTTY === true);

const sgr =
  (open: number | string, close: number) =>
  (s: string): string =>
    colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;

const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const cyan = sgr(36, 39);
/** MotionWorks brand yellow (#faea37). */
export const brand = sgr("38;2;250;234;55", 39);
export const green = sgr(32, 39);
export const yellow = sgr(33, 39);
export const gray = sgr(90, 39);
/** A softer red that stays legible beside the brand yellow in prompts. */
export const mutedRed = sgr("38;2;255;105;97", 39);

/** Status glyphs for step lines. Informative even when color is off. */
export const symbols = {
  done: green("✓"),
  updated: cyan("↑"),
  skipped: gray("•"),
  failed: yellow("✗"),
} as const;

/** One indented step line, e.g. `  ✓ Updated the MotionWorks guide`. */
export function step(symbol: string, message: string): string {
  return `  ${symbol} ${message}`;
}

/** A bold section heading. */
export function heading(text: string): string {
  return bold(text);
}

/** The header shown once at the top of `init`. */
export function banner(version: string): string {
  const logo =
    brand(String.raw`  __ _  ___  / /_(_)__  ___ _    _____  ____/ /__ ___
 /  ' \/ _ \/ __/ / _ \/ _ \ |/|/ / _ \/ __/  '_/(_-<
/_/_/_/\___/\__/_/\___/_//_/__,__/\___/_/ /_/\_\/___/`);
  const ver = dim(`v${version}`);
  const tag = dim(
    "Direct-manipulation motion design layer for AI coding agents",
  );
  return `\n${logo}\n\n  ${ver}\n  ${tag}\n`;
}

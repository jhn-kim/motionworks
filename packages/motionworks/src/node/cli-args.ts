import { resolve } from "node:path";

/** Flags that consume the following token as their value in the space form. */
export const VALUE_FLAGS = new Set(["--port", "--agent"]);

/**
 * Reads a `--name value` / `--name=value` flag. In the space form it will not
 * swallow the next token when that token is itself a flag, so `--agent
 * --no-agent` does not parse "--no-agent" as the agent value (P2-12c).
 */
export function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const next = args[index + 1];
  return next !== undefined && !next.startsWith("-") ? next : undefined;
}

/**
 * The directory to serve: the first positional argument after `serve`,
 * skipping value-bearing flags so `serve --port 5000` serves `.`, not a
 * directory literally named `--port` (P2-12b).
 */
export function serveDir(args: string[]): string {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    return resolve(arg);
  }
  return resolve(".");
}

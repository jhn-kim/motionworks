import type { IncomingMessage, ServerResponse } from "node:http";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackHostname(hostname: string): boolean {
  // `*.localhost` is reserved as loopback (RFC 6761) and browsers resolve it
  // to 127.0.0.1, so tools that dev against e.g. `app.localhost` still work.
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "") return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Guards against DNS rebinding: even when a rebound hostname resolves to
 * 127.0.0.1, the browser still sends the attacker's name in `Host`. Only a
 * loopback `Host` is served. A missing `Host` is rejected — HTTP/1.1 requires
 * it and every browser/`fetch`/`curl` sends one.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  // IPv6 hosts are bracketed (`[::1]` / `[::1]:52340`); keep the brackets so
  // the value matches LOOPBACK_HOSTNAMES. Otherwise strip a trailing :port.
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : (host.split(":")[0] ?? "");
  return isLoopbackHostname(hostname);
}

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    res.statusCode = 403;
    res.end("Forbidden origin");
    return false;
  }
  if (origin !== undefined) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-MotionWorks-Token",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  return true;
}

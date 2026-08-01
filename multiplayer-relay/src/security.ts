import type { RelayConfig } from "./config";

/** Browser Origin checks reduce drive-by relay use; they are not player authentication. */
export function originAllowed(request: Request, config: RelayConfig): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return !config.requireOrigin;
  if (config.allowedOrigins.has("*")) return true;
  return config.allowedOrigins.has(origin);
}

/** Production traffic must arrive through Cloudflare TLS; loopback remains usable for local tests. */
export function secureTransportAllowed(url: URL, config: RelayConfig): boolean {
  if (config.environment !== "production") return true;
  if (url.protocol === "https:") return true;
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Returns only a configured origin, never `*`, for browser-readable diagnostics. */
export function allowedCorsOrigin(request: Request, config: RelayConfig): string | null {
  const origin = request.headers.get("Origin");
  if (!origin || !originAllowed(request, config)) return null;
  return origin;
}

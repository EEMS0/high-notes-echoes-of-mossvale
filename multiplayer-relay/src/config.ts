import { MAX_MESSAGE_BYTES, MAX_ROOM_PLAYERS } from "./protocol";

export interface RelayEnv {
  GAME_ROOMS: DurableObjectNamespace;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  REQUIRE_ORIGIN?: string;
  MAX_ROOM_PLAYERS?: string;
  MAX_MESSAGE_BYTES?: string;
  MAX_MESSAGES_PER_SECOND?: string;
  MAX_BYTES_PER_SECOND?: string;
  RECONNECT_GRACE_SECONDS?: string;
  ROOM_IDLE_TTL_SECONDS?: string;
}
export interface RelayConfig {
  environment: "development" | "production";
  allowedOrigins: ReadonlySet<string>;
  requireOrigin: boolean;
  maxRoomPlayers: number;
  maxMessageBytes: number;
  maxMessagesPerSecond: number;
  maxBytesPerSecond: number;
  reconnectGraceMs: number;
  roomIdleTtlMs: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

export function readConfig(env: RelayEnv): RelayConfig {
  const allowedOrigins = new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  return {
    environment: env.ENVIRONMENT === "development" ? "development" : "production",
    allowedOrigins,
    requireOrigin: env.REQUIRE_ORIGIN !== "false",
    maxRoomPlayers: boundedInteger(env.MAX_ROOM_PLAYERS, MAX_ROOM_PLAYERS, 2, MAX_ROOM_PLAYERS),
    maxMessageBytes: boundedInteger(env.MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES, 1024, 65_536),
    maxMessagesPerSecond: boundedInteger(env.MAX_MESSAGES_PER_SECOND, 45, 10, 120),
    maxBytesPerSecond: boundedInteger(env.MAX_BYTES_PER_SECOND, 98_304, 16_384, 524_288),
    reconnectGraceMs: boundedInteger(env.RECONNECT_GRACE_SECONDS, 30, 5, 180) * 1000,
    roomIdleTtlMs: boundedInteger(env.ROOM_IDLE_TTL_SECONDS, 300, 30, 3600) * 1000,
  };
}

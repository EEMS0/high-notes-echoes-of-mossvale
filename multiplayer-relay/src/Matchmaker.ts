import {
  NETWORK_PROTOCOL_VERSION,
  NETWORK_TICK_RATE_HZ,
  ROOM_CODE_PATTERN,
  SNAPSHOT_RATE_HZ,
} from "./protocol";
import type { RelayConfig } from "./config";
import { validatePlayerId, validateReconnectToken, validateRoomCode } from "./validation";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type ConnectionIntent = "connect" | "create" | "join" | "reconnect";

export interface RelayRoute {
  roomCode: string;
  intent: ConnectionIntent;
  playerId: string | null;
  reconnectToken: string | null;
}

export function createRoomCode(): string {
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  let code = "";
  for (const byte of random) code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  return code;
}

export function parseRelayRoute(url: URL): RelayRoute | null {
  const versionedMatch = /^\/v2\/rooms\/([^/]+)\/?$/.exec(url.pathname);
  const shortMatch = /^\/ws\/([^/]+)\/?$/.exec(url.pathname);
  const queryRoom = url.pathname === "/ws" ? url.searchParams.get("room") : null;
  const rawRoom = versionedMatch?.[1] ?? shortMatch?.[1] ?? queryRoom;
  const roomCode = validateRoomCode(rawRoom ?? null);
  if (!roomCode) return null;

  const rawIntent = (url.searchParams.get("intent") ?? "connect").toLowerCase();
  if (!["connect", "create", "join", "reconnect"].includes(rawIntent)) return null;
  const playerParameter = url.searchParams.get("playerId");
  const tokenParameter = url.searchParams.get("token");
  const playerId = playerParameter === null ? null : validatePlayerId(playerParameter);
  const reconnectToken = tokenParameter === null ? null : validateReconnectToken(tokenParameter);
  if (playerParameter !== null && playerId === null) return null;
  if (tokenParameter !== null && reconnectToken === null) return null;
  if (rawIntent !== "connect" && playerId === null) return null;
  if (rawIntent === "reconnect" && reconnectToken === null) return null;

  return {
    roomCode,
    intent: rawIntent as ConnectionIntent,
    playerId,
    reconnectToken,
  };
}

export function healthPayload(config?: Pick<RelayConfig, "maxRoomPlayers" | "reconnectGraceMs">): Record<string, unknown> {
  return {
    ok: true,
    service: "high-notes-v2-relay",
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    timestamp: Date.now(),
    publicMatchmaking: false,
    authorityModel: "host-authoritative-casual",
    networkTickRateHz: NETWORK_TICK_RATE_HZ,
    snapshotRateHz: SNAPSHOT_RATE_HZ,
    maxRoomPlayers: config?.maxRoomPlayers ?? 4,
    reconnectWindowMs: config?.reconnectGraceMs ?? 30_000,
    roomCodePattern: ROOM_CODE_PATTERN.source,
  };
}

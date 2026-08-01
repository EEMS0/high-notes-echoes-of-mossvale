export const NETWORK_PROTOCOL_VERSION = 2 as const;
export const MAX_ROOM_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 16_384;
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const PLAYER_ID_PATTERN = /^[A-Z0-9]{12}$/;
export const RECONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
export const RELAY_PLAYER_ID = "RELAY0000000";
export const NETWORK_TICK_RATE_HZ = 20;
export const SNAPSHOT_RATE_HZ = 10;

export const CLIENT_MESSAGE_TYPES = [
  "hello",
  "room-create",
  "room-join",
  "room-leave",
  "room-advertise",
  "room-welcome",
  "room-reject",
  "room-sync",
  "profile",
  "player-ready",
  "select-character",
  "select-instrument",
  "select-stage",
  "select-team",
  "match-start",
  "input",
  "arena-input",
  "snapshot",
  "arena-state",
  "arena-snapshot",
  "state-snapshot",
  "state-correction",
  "attack",
  "arena-hit",
  "block",
  "dodge",
  "jump",
  "ability",
  "damage",
  "knockback",
  "knockout",
  "respawn",
  "score-update",
  "match-end",
  "rematch",
  "world-ping",
  "ping",
  "pong",
  "chat",
  "emote",
  "reconnect",
] as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

export const MESSAGE_TYPE_ALIASES: Readonly<Record<string, ClientMessageType>> = Object.freeze({
  create_room: "room-create",
  join_room: "room-join",
  leave_room: "room-leave",
  room_create: "room-create",
  room_join: "room-join",
  room_leave: "room-leave",
  room_advertise: "room-advertise",
  room_welcome: "room-welcome",
  room_reject: "room-reject",
  room_sync: "room-sync",
  player_joined: "room-join",
  player_left: "room-leave",
  player_ready: "player-ready",
  select_character: "select-character",
  select_instrument: "select-instrument",
  select_stage: "select-stage",
  select_team: "select-team",
  match_start: "match-start",
  arena_input: "arena-input",
  state_snapshot: "state-snapshot",
  arena_snapshot: "arena-snapshot",
  state_correction: "state-correction",
  arena_state: "arena-state",
  arena_hit: "arena-hit",
  score_update: "score-update",
  match_end: "match-end",
  world_ping: "world-ping",
});

const CLIENT_MESSAGE_SET = new Set<string>(CLIENT_MESSAGE_TYPES);

export interface NetworkEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  v: typeof NETWORK_PROTOCOL_VERSION;
  type: string;
  from: string;
  room: string;
  payload: TPayload;
  ts: number;
  seq?: number;
  id?: string;
}

export interface ValidatedEnvelope extends NetworkEnvelope {
  canonicalType: ClientMessageType;
}

export interface ProtocolErrorPayload {
  code: string;
  message: string;
  retryAfterMs?: number;
  fatal?: boolean;
}

export function canonicalMessageType(type: string): ClientMessageType | null {
  if (CLIENT_MESSAGE_SET.has(type)) return type as ClientMessageType;
  return MESSAGE_TYPE_ALIASES[type] ?? null;
}

export function createEnvelope(
  type: string,
  from: string,
  room: string,
  payload: Record<string, unknown>,
  sequence?: number,
): NetworkEnvelope {
  const envelope: NetworkEnvelope = {
    v: NETWORK_PROTOCOL_VERSION,
    type,
    from,
    room,
    payload,
    ts: Date.now(),
  };
  if (sequence !== undefined) envelope.seq = sequence;
  return envelope;
}

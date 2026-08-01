import { DurableObject } from "cloudflare:workers";
import type { RelayEnv } from "./config";
import { readConfig, type RelayConfig } from "./config";
import {
  NETWORK_PROTOCOL_VERSION,
  NETWORK_TICK_RATE_HZ,
  PLAYER_ID_PATTERN,
  RELAY_PLAYER_ID,
  SNAPSHOT_RATE_HZ,
  createEnvelope,
  type ClientMessageType,
  type NetworkEnvelope,
  type ValidatedEnvelope,
} from "./protocol";
import {
  consumeRateLimit,
  createRateState,
  registerRateStrike,
  type ConnectionRateState,
} from "./rateLimit";
import { sanitizeProfile, validateClientFrame } from "./validation";

type JsonObject = Record<string, unknown>;
type MatchPhase = "lobby" | "playing" | "results";

interface PlayerState {
  id: string;
  profile: JsonObject;
  ready: boolean;
  character: string;
  instrument: string;
  team: string;
  stageVote: string;
  rematchReady: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
  reconnectUntil: number;
  reconnectTokenHash: string;
}

interface MatchState {
  phase: MatchPhase;
  matchId: string;
  mode: string;
  stage: string;
  stocks: number;
  roster: string[];
  startedAt: number;
  durationMs: number;
  scores: Record<string, number>;
  respawns: Record<string, number>;
  winner: string;
}

interface StoredRoomState {
  storageVersion: 1;
  roomCode: string;
  exists: boolean;
  createdAt: number;
  updatedAt: number;
  emptySince: number;
  hostId: string;
  capacity: number;
  isPublic: boolean;
  mode: string;
  stage: string;
  players: Record<string, PlayerState>;
  match: MatchState;
  serverSequence: number;
}

interface ConnectionAttachment {
  sessionId: string;
  roomCode: string;
  playerId: string;
  joined: boolean;
  tokenHash: string;
  connectedAt: number;
  rates: ConnectionRateState;
  sequences: Partial<Record<ClientMessageType, number>>;
}

interface IdentityResult {
  ok: boolean;
  code: string;
  reconnectToken: string;
  reconnected: boolean;
}

const HOST_ONLY_MESSAGES = new Set<ClientMessageType>([
  "room-advertise",
  "room-welcome",
  "room-reject",
  "match-start",
  "arena-snapshot",
  "state-snapshot",
  "state-correction",
  "damage",
  "knockback",
  "knockout",
  "respawn",
  "score-update",
  "match-end",
  "rematch",
]);

const PLAYABLE_MATCH_MODES = new Set(["stock"]);
const PLAYABLE_STAGES = new Set(["mossvale-amphitheatre"]);

function hasExactRoster(candidateIds: string[], expectedIds: string[]): boolean {
  if (candidateIds.length !== expectedIds.length) return false;
  const candidate = new Set(candidateIds);
  return candidate.size === expectedIds.length && expectedIds.every((id) => candidate.has(id));
}

function projectileOwnerId(owner: unknown): string | null {
  if (typeof owner !== "string") return null;
  if (PLAYER_ID_PATTERN.test(owner)) return owner;
  if (owner.startsWith("net-") && PLAYER_ID_PATTERN.test(owner.slice(4))) return owner.slice(4);
  return null;
}

function defaultMatch(): MatchState {
  return {
    phase: "lobby",
    matchId: "",
    mode: "duel",
    stage: "echo-arena",
    stocks: 3,
    roster: [],
    startedAt: 0,
    durationMs: 90_000,
    scores: {},
    respawns: {},
    winner: "",
  };
}

function defaultRoom(roomCode = "", capacity = 4): StoredRoomState {
  return {
    storageVersion: 1,
    roomCode,
    exists: false,
    createdAt: 0,
    updatedAt: Date.now(),
    emptySince: Date.now(),
    hostId: "",
    capacity,
    isPublic: false,
    mode: "duel",
    stage: "echo-arena",
    players: {},
    match: defaultMatch(),
    serverSequence: 0,
  };
}

function isPlayerState(value: unknown): value is PlayerState {
  if (!value || typeof value !== "object") return false;
  const player = value as Partial<PlayerState>;
  return typeof player.id === "string" && PLAYER_ID_PATTERN.test(player.id) &&
    typeof player.reconnectTokenHash === "string";
}

function normalizeStoredRoom(value: unknown, capacity: number): StoredRoomState {
  if (!value || typeof value !== "object") return defaultRoom("", capacity);
  const source = value as Partial<StoredRoomState>;
  const room = defaultRoom(typeof source.roomCode === "string" ? source.roomCode : "", capacity);
  room.exists = source.exists === true;
  room.createdAt = Number.isFinite(source.createdAt) ? Number(source.createdAt) : 0;
  room.updatedAt = Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : Date.now();
  room.emptySince = Number.isFinite(source.emptySince) ? Number(source.emptySince) : Date.now();
  room.hostId = typeof source.hostId === "string" && PLAYER_ID_PATTERN.test(source.hostId)
    ? source.hostId
    : "";
  room.capacity = Math.min(capacity, Math.max(2, Math.floor(Number(source.capacity) || capacity)));
  room.isPublic = source.isPublic === true;
  room.mode = typeof source.mode === "string" ? source.mode.slice(0, 32) : "duel";
  room.stage = typeof source.stage === "string" ? source.stage.slice(0, 32) : "echo-arena";
  if (source.players && typeof source.players === "object") {
    for (const [id, candidate] of Object.entries(source.players)) {
      if (id === (candidate as PlayerState | undefined)?.id && isPlayerState(candidate)) {
        room.players[id] = candidate;
      }
    }
  }
  if (source.match && typeof source.match === "object") {
    const match = source.match;
    room.match = {
      phase: ["lobby", "playing", "results"].includes(match.phase) ? match.phase : "lobby",
      matchId: typeof match.matchId === "string" ? match.matchId.slice(0, 48) : "",
      mode: typeof match.mode === "string" ? match.mode.slice(0, 32) : room.mode,
      stage: typeof match.stage === "string" ? match.stage.slice(0, 32) : room.stage,
      stocks: Number.isInteger(match.stocks) ? Math.min(5, Math.max(1, match.stocks)) : 3,
      roster: Array.isArray(match.roster)
        ? Array.from(new Set(match.roster.filter(
          (id): id is string => typeof id === "string" && PLAYER_ID_PATTERN.test(id),
        ))).slice(0, 4)
        : [],
      startedAt: Number.isFinite(match.startedAt) ? Number(match.startedAt) : 0,
      durationMs: Number.isFinite(match.durationMs)
        ? Math.min(1_800_000, Math.max(10_000, Number(match.durationMs)))
        : 90_000,
      scores: match.scores && typeof match.scores === "object" ? match.scores : {},
      respawns: match.respawns && typeof match.respawns === "object" ? match.respawns : {},
      winner: typeof match.winner === "string" && PLAYER_ID_PATTERN.test(match.winner)
        ? match.winner
        : "",
    };
  }
  room.serverSequence = Number.isInteger(source.serverSequence)
    ? Math.max(0, Number(source.serverSequence))
    : 0;
  return room;
}

function defaultAttachment(roomCode: string): ConnectionAttachment {
  return {
    sessionId: crypto.randomUUID(),
    roomCode,
    playerId: "",
    joined: false,
    tokenHash: "",
    connectedAt: Date.now(),
    rates: createRateState(),
    sequences: {},
  };
}

function attachmentFor(socket: WebSocket, roomCode: string): ConnectionAttachment {
  const value = socket.deserializeAttachment();
  if (!value || typeof value !== "object") return defaultAttachment(roomCode);
  const candidate = value as Partial<ConnectionAttachment>;
  return {
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : crypto.randomUUID(),
    roomCode,
    playerId: typeof candidate.playerId === "string" && PLAYER_ID_PATTERN.test(candidate.playerId)
      ? candidate.playerId
      : "",
    joined: candidate.joined === true,
    tokenHash: typeof candidate.tokenHash === "string" ? candidate.tokenHash : "",
    connectedAt: Number.isFinite(candidate.connectedAt) ? Number(candidate.connectedAt) : Date.now(),
    rates: candidate.rates && typeof candidate.rates === "object"
      ? candidate.rates
      : createRateState(),
    sequences: candidate.sequences && typeof candidate.sequences === "object"
      ? candidate.sequences
      : {},
  };
}

function generateReconnectToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class GameRoom extends DurableObject<RelayEnv> {
  private readonly config: RelayConfig;
  private room: StoredRoomState;

  constructor(ctx: DurableObjectState, env: RelayEnv) {
    super(ctx, env);
    this.config = readConfig(env);
    this.room = defaultRoom("", this.config.maxRoomPlayers);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredRoomState>("room");
      this.room = normalizeStoredRoom(stored, this.config.maxRoomPlayers);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ ok: false, error: "websocket_upgrade_required" }, { status: 426 });
    }
    const roomCode = request.headers.get("X-HN-Room") ?? "";
    const intent = request.headers.get("X-HN-Intent") ?? "connect";
    const requestedPlayerId = request.headers.get("X-HN-Player") ?? "";
    const reconnectToken = request.headers.get("X-HN-Token") ?? "";
    if (!roomCode) return Response.json({ ok: false, error: "invalid_room" }, { status: 400 });
    if (this.room.roomCode && this.room.roomCode !== roomCode) {
      return Response.json({ ok: false, error: "room_identity_mismatch" }, { status: 409 });
    }
    this.room.roomCode = roomCode;
    const openConnections = this.ctx.getWebSockets().filter((socket) => socket.readyState < 2).length;
    if (openConnections >= this.config.maxRoomPlayers * 2) {
      return Response.json({ ok: false, error: "room_connection_limit" }, {
        status: 429,
        headers: { "Retry-After": "2" },
      });
    }

    const pair = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const [client, server] = pair;
    const attachment = defaultAttachment(roomCode);
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [roomCode]);

    if (requestedPlayerId) {
      const identity = await this.claimIdentity(server, attachment, requestedPlayerId, reconnectToken);
      if (!identity.ok) {
        this.rejectConnection(server, requestedPlayerId, identity.code);
      } else if (intent === "create") {
        await this.createRoom(server, attachment, {}, identity);
      } else if (intent === "join" || intent === "reconnect") {
        await this.joinRoom(server, attachment, {}, identity);
      } else {
        this.sendWelcome(server, attachment, identity);
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer): Promise<void> {
    const attachment = attachmentFor(socket, this.room.roomCode);
    const validated = validateClientFrame(frame, this.room.roomCode, this.config.maxMessageBytes);
    if (!validated.ok) {
      const fatal = validated.code === "protocol_mismatch" ||
        validated.code === "message_too_large" ||
        validated.code === "binary_not_supported";
      this.sendError(socket, validated.code, validated.message, undefined, fatal);
      if (fatal) socket.close(validated.code === "message_too_large" ? 1009 : 1002, validated.code);
      else this.strike(socket, attachment, validated.code);
      return;
    }

    const now = Date.now();
    const rate = consumeRateLimit(
      attachment.rates,
      now,
      validated.bytes,
      validated.value.canonicalType,
      this.config,
    );
    if (!rate.allowed) {
      this.sendError(socket, "rate_limited", "Too many messages; slow down.", rate.retryAfterMs);
      this.strike(socket, attachment, rate.reason ?? "rate_limited");
      return;
    }

    const message = validated.value;
    if (!attachment.playerId) {
      if (!["hello", "room-create", "room-join", "reconnect"].includes(message.canonicalType)) {
        this.sendError(socket, "hello_required", "Send hello before room messages.", undefined, true);
        socket.close(1008, "hello_required");
        return;
      }
      const token = typeof message.payload.reconnectToken === "string"
        ? message.payload.reconnectToken
        : "";
      const identity = await this.claimIdentity(socket, attachment, message.from, token);
      if (!identity.ok) {
        this.rejectConnection(socket, message.from, identity.code);
        return;
      }
      if (message.canonicalType === "hello") {
        this.sendWelcome(socket, attachment, identity);
        return;
      }
      if (message.canonicalType === "room-create") {
        await this.createRoom(socket, attachment, message.payload, identity);
        return;
      }
      await this.joinRoom(socket, attachment, message.payload, identity);
      return;
    }

    if (message.from !== attachment.playerId) {
      this.sendError(socket, "identity_spoof", "Message identity does not match this socket.", undefined, true);
      socket.close(1008, "identity_spoof");
      return;
    }
    if (message.seq !== undefined) {
      const previous = attachment.sequences[message.canonicalType];
      if (previous !== undefined && message.seq <= previous) {
        this.sendError(socket, "stale_sequence", "Duplicate or out-of-order message ignored.");
        return;
      }
      attachment.sequences[message.canonicalType] = message.seq;
    }
    socket.serializeAttachment(attachment);

    if (message.canonicalType === "hello") {
      const identity: IdentityResult = {
        ok: true,
        code: "ok",
        reconnectToken: "",
        reconnected: attachment.joined,
      };
      this.sendWelcome(socket, attachment, identity);
      return;
    }
    if (message.canonicalType === "room-create") {
      await this.createRoom(socket, attachment, message.payload, {
        ok: true,
        code: "ok",
        reconnectToken: "",
        reconnected: false,
      });
      return;
    }
    if (message.canonicalType === "room-join" || message.canonicalType === "reconnect") {
      await this.joinRoom(socket, attachment, message.payload, {
        ok: true,
        code: "ok",
        reconnectToken: "",
        reconnected: attachment.joined,
      });
      return;
    }
    if (message.canonicalType === "room-leave") {
      await this.leaveRoom(socket, attachment, "left");
      return;
    }
    if (!attachment.joined || !this.room.players[attachment.playerId]) {
      this.sendError(socket, "not_in_room", "Join the room before sending this message.");
      return;
    }
    const player = this.room.players[attachment.playerId];
    if (!player) return;
    player.lastSeenAt = now;

    if (HOST_ONLY_MESSAGES.has(message.canonicalType) && this.room.hostId !== attachment.playerId) {
      this.sendError(socket, "host_only", "Only the room host can send this message.");
      return;
    }

    const handled = await this.handleRoomControl(socket, attachment, message);
    if (!handled) this.forwardGameplay(socket, attachment, message);
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.disconnect(socket, attachmentFor(socket, this.room.roomCode), "disconnected");
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    console.warn("Room WebSocket error", this.room.roomCode, String(error));
    await this.disconnect(socket, attachmentFor(socket, this.room.roomCode), "network_error");
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const changed = this.sweepExpiredPlayers(now);
    const activeSockets = this.ctx.getWebSockets().filter((socket) => socket.readyState === 1).length;
    if (activeSockets === 0 && Object.keys(this.room.players).length === 0) {
      if (!this.room.emptySince) this.room.emptySince = now;
      if (now - this.room.emptySince >= this.config.roomIdleTtlMs) {
        await this.ctx.storage.deleteAll();
        this.room = defaultRoom(this.room.roomCode, this.config.maxRoomPlayers);
        return;
      }
    }
    if (changed) await this.persist();
    await this.scheduleAlarm();
  }

  private async claimIdentity(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    playerId: string,
    reconnectToken: string,
  ): Promise<IdentityResult> {
    if (!PLAYER_ID_PATTERN.test(playerId)) {
      return { ok: false, code: "invalid_identity", reconnectToken: "", reconnected: false };
    }
    if (attachment.playerId && attachment.playerId !== playerId) {
      return { ok: false, code: "identity_locked", reconnectToken: "", reconnected: false };
    }
    const existingPlayer = this.room.players[playerId];
    let reconnected = false;
    if (existingPlayer) {
      if (!reconnectToken || await hashToken(reconnectToken) !== existingPlayer.reconnectTokenHash) {
        return { ok: false, code: "identity_reserved", reconnectToken: "", reconnected: false };
      }
      reconnected = true;
      for (const existingSocket of this.ctx.getWebSockets()) {
        if (existingSocket === socket) continue;
        const existingAttachment = attachmentFor(existingSocket, this.room.roomCode);
        if (existingAttachment.playerId === playerId && existingSocket.readyState === 1) {
          this.sendError(existingSocket, "session_replaced", "A verified reconnect replaced this session.", undefined, true);
          existingSocket.close(4001, "session_replaced");
        }
      }
    } else if (reconnectToken) {
      return { ok: false, code: "reconnect_expired", reconnectToken: "", reconnected: false };
    } else {
      for (const existingSocket of this.ctx.getWebSockets()) {
        if (existingSocket === socket) continue;
        const existingAttachment = attachmentFor(existingSocket, this.room.roomCode);
        if (existingAttachment.playerId === playerId && existingSocket.readyState === 1) {
          return { ok: false, code: "duplicate_identity", reconnectToken: "", reconnected: false };
        }
      }
    }

    const newToken = generateReconnectToken();
    attachment.playerId = playerId;
    attachment.tokenHash = await hashToken(newToken);
    attachment.joined = existingPlayer !== undefined;
    socket.serializeAttachment(attachment);
    if (existingPlayer) {
      existingPlayer.reconnectTokenHash = attachment.tokenHash;
      existingPlayer.connected = true;
      existingPlayer.reconnectUntil = 0;
      existingPlayer.lastSeenAt = Date.now();
      await this.persist();
    }
    return { ok: true, code: "ok", reconnectToken: newToken, reconnected };
  }

  private async createRoom(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    payload: JsonObject,
    identity: IdentityResult,
  ): Promise<void> {
    this.sweepExpiredPlayers(Date.now());
    const others = Object.keys(this.room.players).filter((id) => id !== attachment.playerId);
    if (this.room.exists && others.length > 0) {
      this.rejectConnection(socket, attachment.playerId, "room_exists");
      return;
    }
    this.room.exists = true;
    this.room.createdAt ||= Date.now();
    this.room.emptySince = 0;
    const requestedCapacity = typeof payload.limit === "number" ? payload.limit : this.config.maxRoomPlayers;
    this.room.capacity = Math.min(this.config.maxRoomPlayers, Math.max(2, Math.floor(requestedCapacity)));
    this.room.isPublic = payload.public === true;
    if (typeof payload.mode === "string") this.room.mode = payload.mode;
    await this.addMember(socket, attachment, payload, identity);
  }

  private async joinRoom(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    payload: JsonObject,
    identity: IdentityResult,
  ): Promise<void> {
    this.sweepExpiredPlayers(Date.now());
    if (!this.room.exists) {
      this.rejectConnection(socket, attachment.playerId, "room_not_found");
      return;
    }
    if (this.room.match.phase === "playing" && !this.room.players[attachment.playerId]) {
      this.rejectConnection(socket, attachment.playerId, "match_in_progress");
      return;
    }
    if (!this.room.players[attachment.playerId] && Object.keys(this.room.players).length >= this.room.capacity) {
      this.rejectConnection(socket, attachment.playerId, "room_full");
      return;
    }
    await this.addMember(socket, attachment, payload, identity);
  }

  private async addMember(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    payload: JsonObject,
    identity: IdentityResult,
  ): Promise<void> {
    const now = Date.now();
    const existing = this.room.players[attachment.playerId];
    const profile = payload.profile ? sanitizeProfile(payload.profile) : null;
    const player: PlayerState = existing ?? {
      id: attachment.playerId,
      profile: profile ?? { displayName: "Mossvale Player", cosmetic: "grove" },
      ready: false,
      character: "eems",
      instrument: "electric-guitar",
      team: "none",
      stageVote: "",
      rematchReady: false,
      connected: true,
      joinedAt: now,
      lastSeenAt: now,
      reconnectUntil: 0,
      reconnectTokenHash: attachment.tokenHash,
    };
    if (profile) player.profile = profile;
    player.connected = true;
    player.lastSeenAt = now;
    player.reconnectUntil = 0;
    player.reconnectTokenHash = attachment.tokenHash;
    this.room.players[player.id] = player;
    attachment.joined = true;
    socket.serializeAttachment(attachment);
    if (!this.room.hostId || !this.room.players[this.room.hostId]?.connected) this.room.hostId = player.id;
    this.room.emptySince = 0;
    await this.persist();

    this.sendWelcome(socket, attachment, identity);
    this.sendRoomWelcome(socket, player.id);
    this.broadcast(
      createEnvelope("room-join", player.id, this.room.roomCode, {
        profile: player.profile,
        reconnected: identity.reconnected,
      }),
      socket,
    );
  }

  private async leaveRoom(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    reason: string,
  ): Promise<void> {
    if (!attachment.playerId || !this.room.players[attachment.playerId]) return;
    const departing = attachment.playerId;
    const forfeitedActiveMatch = this.room.match.phase === "playing" &&
      this.room.match.roster.includes(departing);
    delete this.room.players[departing];
    attachment.joined = false;
    attachment.tokenHash = "";
    socket.serializeAttachment(attachment);
    const leavePayload: JsonObject = {
      reason: forfeitedActiveMatch ? "forfeit" : reason,
      temporary: false,
    };
    if (forfeitedActiveMatch) leavePayload.matchId = this.room.match.matchId;
    this.broadcast(createEnvelope("room-leave", departing, this.room.roomCode, leavePayload), socket);
    this.transferHostIfNeeded(departing);
    if (Object.keys(this.room.players).length === 0) {
      this.room.exists = false;
      this.room.emptySince = Date.now();
      this.room.match = defaultMatch();
    }
    await this.persist();
    await this.scheduleAlarm();
  }

  private async disconnect(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    reason: string,
  ): Promise<void> {
    if (!attachment.joined || !attachment.playerId) return;
    const replacementIsActive = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket || candidate.readyState !== 1) return false;
      const candidateAttachment = attachmentFor(candidate, this.room.roomCode);
      return candidateAttachment.joined && candidateAttachment.playerId === attachment.playerId;
    });
    if (replacementIsActive) return;
    const player = this.room.players[attachment.playerId];
    if (!player || !player.connected) return;
    player.connected = false;
    player.lastSeenAt = Date.now();
    player.reconnectUntil = Date.now() + this.config.reconnectGraceMs;
    attachment.joined = false;
    socket.serializeAttachment(attachment);
    const disconnectPayload: JsonObject = {
      reason,
      temporary: true,
      reconnectUntil: player.reconnectUntil,
    };
    if (this.room.match.phase === "playing" && this.room.match.roster.includes(player.id)) {
      disconnectPayload.matchId = this.room.match.matchId;
    }
    this.broadcast(createEnvelope("room-leave", player.id, this.room.roomCode, disconnectPayload), socket);
    this.transferHostIfNeeded(player.id);
    await this.persist();
    await this.scheduleAlarm();
  }

  private async handleRoomControl(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    message: ValidatedEnvelope,
  ): Promise<boolean> {
    const player = this.room.players[attachment.playerId];
    if (!player) return true;
    if (message.canonicalType === "room-sync") {
      this.sendRoomWelcome(socket, player.id);
      return true;
    } else if (message.canonicalType === "profile") {
      const profile = sanitizeProfile(message.payload);
      if (profile) player.profile = profile;
    } else if (message.canonicalType === "player-ready") {
      player.ready = message.payload.ready === true;
      if (typeof message.payload.instrument === "string") player.instrument = message.payload.instrument;
    } else if (message.canonicalType === "select-character") {
      player.character = String(message.payload.character);
    } else if (message.canonicalType === "select-instrument") {
      player.instrument = String(message.payload.instrument);
    } else if (message.canonicalType === "select-team") {
      player.team = String(message.payload.team);
    } else if (message.canonicalType === "select-stage") {
      player.stageVote = String(message.payload.stage);
      if (this.room.hostId === player.id) this.room.stage = player.stageVote;
    } else if (message.canonicalType === "match-start" || message.canonicalType === "rematch") {
      const connected = Object.values(this.room.players).filter((candidate) => candidate.connected);
      if (connected.length < 2 || connected.some((candidate) => !candidate.ready)) {
        this.sendError(socket, "players_not_ready", "At least two connected players must be ready.");
        return true;
      }
      if (message.canonicalType === "match-start" && this.room.match.phase === "playing") {
        this.sendError(socket, "match_in_progress", "A match is already in progress.");
        return true;
      }
      if (message.canonicalType === "rematch" && this.room.match.phase !== "results") {
        this.sendError(socket, "rematch_unavailable", "A rematch can only begin after results.");
        return true;
      }
      const roster = message.payload.players as JsonObject[];
      const rosterIds = roster.map((entry) => String(entry.id));
      const connectedIds = connected.map((candidate) => candidate.id);
      if (!hasExactRoster(rosterIds, connectedIds)) {
        this.sendError(socket, "invalid_roster", "Match roster must contain every connected room member once.");
        return true;
      }
      if (!PLAYABLE_MATCH_MODES.has(String(message.payload.mode)) ||
          !PLAYABLE_STAGES.has(String(message.payload.stage))) {
        this.sendError(socket, "unsupported_ruleset", "That match mode or stage is not enabled on this relay.");
        return true;
      }
      for (const entry of roster) {
        const member = this.room.players[String(entry.id)];
        if (!member || member.instrument !== String(entry.instrument)) {
          this.sendError(socket, "loadout_mismatch", "Match loadouts must match each player's ready selection.");
          return true;
        }
      }
      const startAt = Number(message.payload.startAt);
      const now = Date.now();
      if (!Number.isFinite(startAt) || startAt < now - 5000 || startAt > now + 30_000) {
        this.sendError(socket, "invalid_start_time", "Match start time is outside the allowed window.");
        return true;
      }
      const matchId = String(message.payload.matchId);
      if (matchId === this.room.match.matchId) {
        this.sendError(socket, "duplicate_match", "Match ID has already been used in this room state.");
        return true;
      }
      this.room.match = {
        phase: "playing",
        matchId,
        mode: String(message.payload.mode),
        stage: String(message.payload.stage),
        stocks: Number(message.payload.stocks),
        roster: rosterIds,
        startedAt: startAt,
        durationMs: Number(message.payload.duration) * 1000,
        scores: {},
        respawns: {},
        winner: "",
      };
      this.room.mode = this.room.match.mode;
      this.room.stage = this.room.match.stage;
      for (const candidate of connected) candidate.rematchReady = false;
    } else if (message.canonicalType === "match-end") {
      if (this.room.match.phase !== "playing" || message.payload.matchId !== this.room.match.matchId) {
        this.sendError(socket, "match_mismatch", "Match end does not match the active room match.");
        return true;
      }
      const activeRoster = this.room.match.roster.length
        ? this.room.match.roster
        : Object.keys(this.room.players);
      if (typeof message.payload.winner === "string" && message.payload.winner &&
          !activeRoster.includes(message.payload.winner)) {
        this.sendError(socket, "invalid_winner", "Winner must be a fighter in the active match.");
        return true;
      }
      if (typeof message.payload.abandonedBy === "string" &&
          message.payload.abandonedBy !== attachment.playerId) {
        this.sendError(socket, "identity_spoof", "A host may only report its own abandonment.");
        return true;
      }
      let resultScores: Record<string, number> | null = null;
      if (Array.isArray(message.payload.fighters)) {
        const resultIds = (message.payload.fighters as JsonObject[]).map((fighter) => String(fighter.id));
        if (!hasExactRoster(resultIds, activeRoster)) {
          this.sendError(socket, "invalid_roster", "Results must contain every active fighter once.");
          return true;
        }
        resultScores = {};
        for (const fighter of message.payload.fighters as JsonObject[]) {
          const id = String(fighter.id);
          if (Number(fighter.stocks) > this.room.match.stocks) {
            this.sendError(socket, "invalid_result", "Result stocks exceed the active match rules.");
            return true;
          }
          resultScores[id] = Number(fighter.knockouts);
        }
      }
      this.room.match.phase = "results";
      if (typeof message.payload.winner === "string") this.room.match.winner = message.payload.winner;
      if (resultScores) this.room.match.scores = resultScores;
    } else if (message.canonicalType === "score-update") {
      if (message.payload.scores && typeof message.payload.scores === "object") {
        this.room.match.scores = message.payload.scores as Record<string, number>;
      }
    } else if (message.canonicalType === "respawn") {
      const target = typeof message.payload.target === "string" ? message.payload.target : player.id;
      this.room.match.respawns[target] = (this.room.match.respawns[target] ?? 0) + 1;
    } else if (message.canonicalType === "room-advertise") {
      this.room.isPublic = message.payload.public === true;
      if (typeof message.payload.mode === "string") this.room.mode = message.payload.mode;
    } else if (message.canonicalType === "room-welcome" || message.canonicalType === "room-reject") {
      const target = String(message.payload.target ?? "");
      this.sendToPlayer(target, message);
      return true;
    } else if (["chat", "emote", "world-ping"].includes(message.canonicalType)) {
      this.broadcastClientMessage(socket, attachment, message);
      return true;
    } else if (message.canonicalType === "ping" || message.canonicalType === "pong") {
      const target = typeof message.payload.target === "string" ? message.payload.target : "";
      if (target) this.sendToPlayer(target, message);
      else this.broadcastClientMessage(socket, attachment, message);
      return true;
    } else {
      return false;
    }

    this.room.updatedAt = Date.now();
    await this.persist();
    if (message.canonicalType === "match-start" || message.canonicalType === "rematch") {
      // The originating host waits for this relay-validated echo before it
      // starts locally. That prevents optimistic BroadcastChannel state from
      // diverging when readiness, roster, or ruleset validation rejects a set.
      this.direct(socket, message);
    }
    this.broadcastClientMessage(socket, attachment, message);
    return true;
  }

  private forwardGameplay(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    message: ValidatedEnvelope,
  ): void {
    if (message.canonicalType === "arena-input" || message.canonicalType === "arena-snapshot") {
      if (this.room.match.phase !== "playing" || message.payload.matchId !== this.room.match.matchId) {
        this.sendError(socket, "match_mismatch", "Gameplay packet does not match the active room match.");
        return;
      }
      const activeRoster = this.room.match.roster.length
        ? this.room.match.roster
        : Object.keys(this.room.players);
      if (message.canonicalType === "arena-input") {
        if (attachment.playerId === this.room.hostId) {
          this.sendError(socket, "host_input_rejected", "The authoritative host does not relay client input packets.");
          return;
        }
        if (!activeRoster.includes(attachment.playerId)) {
          this.sendError(socket, "not_in_match", "Only active fighters may send arena input.");
          return;
        }
        this.sendToPlayer(this.room.hostId, message);
        return;
      }
      const fighters = message.payload.fighters as JsonObject[];
      const snapshotIds = fighters.map((fighter) => String(fighter.id));
      if (!hasExactRoster(snapshotIds, activeRoster)) {
        this.sendError(socket, "invalid_roster", "Snapshot must contain every active fighter once.");
        return;
      }
      if (fighters.some((fighter) => Number(fighter.stocks) > this.room.match.stocks)) {
        this.sendError(socket, "invalid_snapshot", "Snapshot stocks exceed the active match rules.");
        return;
      }
      const maximumTime = this.room.match.durationMs / 1000 + 1;
      if (message.payload.phase !== "playing" || Number(message.payload.time) > maximumTime) {
        this.sendError(socket, "invalid_snapshot", "Snapshot phase or timer does not match the active rules.");
        return;
      }
      const projectiles = message.payload.projectiles as JsonObject[];
      if (projectiles.some((projectile) => {
        const owner = projectileOwnerId(projectile.owner);
        return owner === null || !activeRoster.includes(owner);
      })) {
        this.sendError(socket, "invalid_projectile_owner", "Projectile owner is not an active fighter.");
        return;
      }
    }
    const target = typeof message.payload.target === "string" ? message.payload.target : "";
    if (target) {
      if (target === attachment.playerId || !this.room.players[target]) {
        this.sendError(socket, "invalid_target", "Target must be another room member.");
        return;
      }
      this.sendToPlayer(target, message);
      return;
    }
    this.broadcastClientMessage(socket, attachment, message);
  }

  private broadcastClientMessage(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    message: ValidatedEnvelope,
  ): void {
    const envelope: NetworkEnvelope = {
      v: NETWORK_PROTOCOL_VERSION,
      type: message.type,
      from: attachment.playerId,
      room: this.room.roomCode,
      payload: message.payload,
      ts: message.ts,
    };
    if (message.seq !== undefined) envelope.seq = message.seq;
    if (message.id !== undefined) envelope.id = message.id;
    this.broadcast(envelope, socket);
  }

  private sendWelcome(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    identity: IdentityResult,
  ): void {
    this.direct(socket, createEnvelope("welcome", RELAY_PLAYER_ID, this.room.roomCode, {
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      playerId: attachment.playerId,
      reconnectToken: identity.reconnectToken || undefined,
      reconnected: identity.reconnected,
      joined: attachment.joined,
      host: this.room.hostId,
      capacity: this.room.capacity,
      serverTime: Date.now(),
      publicMatchmaking: false,
      authorityModel: "host-authoritative-casual",
      networkTickRateHz: NETWORK_TICK_RATE_HZ,
      snapshotRateHz: SNAPSHOT_RATE_HZ,
      reconnectWindowMs: this.config.reconnectGraceMs,
      playerCount: Object.values(this.room.players).filter((player) => player.connected).length,
    }));
  }

  private sendRoomWelcome(socket: WebSocket, target: string): void {
    const from = this.room.hostId || RELAY_PLAYER_ID;
    this.direct(socket, createEnvelope("room-welcome", from, this.room.roomCode, {
      target,
      host: this.room.hostId,
      public: this.room.isPublic,
      capacity: this.room.capacity,
      mode: this.room.mode,
      stage: this.room.stage,
      match: this.publicMatchState(),
      peers: this.publicPlayers(),
    }));
  }

  private publicPlayers(): JsonObject[] {
    return Object.values(this.room.players).map((player) => ({
      id: player.id,
      profile: player.profile,
      ready: player.ready,
      character: player.character,
      instrument: player.instrument,
      team: player.team,
      stageVote: player.stageVote,
      connected: player.connected,
    }));
  }

  private publicMatchState(): JsonObject {
    const match = this.room.match;
    const elapsed = match.phase === "playing" ? Math.max(0, Date.now() - match.startedAt) : 0;
    return {
      phase: match.phase,
      matchId: match.matchId,
      mode: match.mode,
      stage: match.stage,
      stocks: match.stocks,
      roster: match.roster,
      startedAt: match.startedAt,
      durationMs: match.durationMs,
      remainingMs: Math.max(0, match.durationMs - elapsed),
      scores: match.scores,
      respawns: match.respawns,
      winner: match.winner,
    };
  }

  private transferHostIfNeeded(departingId: string): void {
    if (this.room.hostId !== departingId && this.room.players[this.room.hostId]?.connected) return;
    const next = Object.values(this.room.players)
      .filter((player) => player.connected && player.id !== departingId)
      .sort((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id))[0];
    const nextHost = next?.id ?? "";
    if (nextHost === this.room.hostId) return;
    this.room.hostId = nextHost;
    if (nextHost) {
      this.broadcast(createEnvelope("host-migrate", nextHost, this.room.roomCode, { host: nextHost }));
    }
  }

  private sweepExpiredPlayers(now: number): boolean {
    let changed = false;
    for (const [id, player] of Object.entries(this.room.players)) {
      if (!player.connected && player.reconnectUntil > 0 && player.reconnectUntil <= now) {
        const timeoutPayload: JsonObject = {
          reason: "reconnect-timeout",
          temporary: false,
          reconnectUntil: player.reconnectUntil,
        };
        if (this.room.match.phase === "playing" && this.room.match.roster.includes(id)) {
          timeoutPayload.matchId = this.room.match.matchId;
        }
        delete this.room.players[id];
        this.broadcast(createEnvelope("room-leave", id, this.room.roomCode, timeoutPayload));
        changed = true;
      }
    }
    if (this.room.hostId && !this.room.players[this.room.hostId]?.connected) {
      this.transferHostIfNeeded(this.room.hostId);
      changed = true;
    }
    if (Object.keys(this.room.players).length === 0 && !this.room.emptySince) {
      this.room.exists = false;
      this.room.emptySince = now;
      this.room.match = defaultMatch();
      changed = true;
    }
    return changed;
  }

  private rejectConnection(socket: WebSocket, target: string, reason: string): void {
    this.sendError(socket, reason, reason.replace(/_/g, " "), undefined, true);
    this.direct(socket, createEnvelope("room-reject", this.room.hostId || RELAY_PLAYER_ID, this.room.roomCode, {
      target,
      reason,
    }));
    socket.close(1008, reason);
  }

  private strike(socket: WebSocket, attachment: ConnectionAttachment, reason: string): void {
    const strikes = registerRateStrike(attachment.rates, Date.now());
    socket.serializeAttachment(attachment);
    if (strikes >= 5) {
      this.sendError(socket, "too_many_violations", "Connection closed after repeated invalid messages.", undefined, true);
      socket.close(1008, reason.slice(0, 64));
    }
  }

  private sendError(
    socket: WebSocket,
    code: string,
    message: string,
    retryAfterMs?: number,
    fatal = false,
  ): void {
    const payload: JsonObject = { code, message, fatal };
    if (retryAfterMs !== undefined) payload.retryAfterMs = retryAfterMs;
    this.direct(socket, createEnvelope("error", RELAY_PLAYER_ID, this.room.roomCode, payload));
  }

  private sendToPlayer(playerId: string, envelope: NetworkEnvelope | ValidatedEnvelope): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentFor(socket, this.room.roomCode);
      if (attachment.playerId === playerId && attachment.joined) this.direct(socket, envelope);
    }
  }

  private broadcast(envelope: NetworkEnvelope, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      const attachment = attachmentFor(socket, this.room.roomCode);
      if (attachment.joined && socket.readyState === 1) this.direct(socket, envelope);
    }
  }

  private direct(socket: WebSocket, envelope: NetworkEnvelope | ValidatedEnvelope): void {
    if (socket.readyState !== 1) return;
    const { canonicalType: _canonicalType, ...wireEnvelope } = envelope as ValidatedEnvelope;
    socket.send(JSON.stringify(wireEnvelope));
  }

  private async persist(): Promise<void> {
    this.room.updatedAt = Date.now();
    this.room.serverSequence += 1;
    await this.ctx.storage.put("room", this.room);
  }

  private async scheduleAlarm(): Promise<void> {
    const now = Date.now();
    const reconnectDeadlines = Object.values(this.room.players)
      .filter((player) => !player.connected && player.reconnectUntil > now)
      .map((player) => player.reconnectUntil);
    let next = reconnectDeadlines.length ? Math.min(...reconnectDeadlines) : 0;
    if (Object.keys(this.room.players).length === 0 && this.room.emptySince) {
      const cleanupAt = this.room.emptySince + this.config.roomIdleTtlMs;
      next = next ? Math.min(next, cleanupAt) : cleanupAt;
    }
    if (next) await this.ctx.storage.setAlarm(Math.max(now + 1000, next));
  }
}

import {
  MAX_MESSAGE_BYTES,
  NETWORK_PROTOCOL_VERSION,
  PLAYER_ID_PATTERN,
  RECONNECT_TOKEN_PATTERN,
  ROOM_CODE_PATTERN,
  canonicalMessageType,
  type ClientMessageType,
  type ValidatedEnvelope,
} from "./protocol";

type JsonObject = Record<string, unknown>;

export interface ValidationFailure {
  ok: false;
  code: string;
  message: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
  bytes: number;
}

export type ValidationResult<T> = ValidationFailure | ValidationSuccess<T>;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/i;
const TEAM_PATTERN = /^(none|spectator|[1-4]|red|blue|green|gold)$/i;
const EMOTES = new Set(["Encore!", "Nice block!", "Over here!", "Ready?"]);
const INPUT_BUTTONS = new Set([
  "left",
  "right",
  "up",
  "down",
  "jump",
  "attack",
  "block",
  "dodge",
  "ability",
  "special",
]);
const FIGHTER_ACTIONS = new Set(["jump", "attack", "special", "dodge", "charge", "ultimate"]);
const EQUIPMENT_IDS = new Set(["guitar", "bass", "synth", "drums", "microphone", "violin"]);
const EQUIPMENT_STATES = new Set([
  "idle", "walk", "run", "attack", "charged", "special", "block", "dash",
  "dodge", "hurt", "stun", "death", "respawn", "switch", "victory", "defeat",
]);
const EQUIPMENT_DIRECTIONS = new Set(["north", "south", "east", "west"]);
const MATCH_PHASES = new Set(["countdown", "playing", "results"]);
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{4,48}$/;
const FIGHTER_OWNER_PATTERN = /^(?:net-)?[A-Z0-9]{12}$/;

function failure(code: string, message: string): ValidationFailure {
  return { ok: false, code, message };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > maximum) return null;
  return cleaned;
}

function sanitizeFighterOwnerIds(value: unknown, maximum = 4): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    const id = cleanText(rawId, 24);
    if (!id || !FIGHTER_OWNER_PATTERN.test(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function optionalText(value: unknown, maximum: number): string | undefined | null {
  if (value === undefined) return undefined;
  return cleanText(value, maximum);
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < minimum || value > maximum) return null;
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const numeric = boundedNumber(value, minimum, maximum);
  return numeric !== null && Number.isInteger(numeric) ? numeric : null;
}

function optionalNumber(
  source: JsonObject,
  key: string,
  target: JsonObject,
  minimum: number,
  maximum: number,
): boolean {
  if (source[key] === undefined) return true;
  const numeric = boundedNumber(source[key], minimum, maximum);
  if (numeric === null) return false;
  target[key] = numeric;
  return true;
}

function optionalInteger(
  source: JsonObject,
  key: string,
  target: JsonObject,
  minimum: number,
  maximum: number,
): boolean {
  if (source[key] === undefined) return true;
  const numeric = boundedInteger(source[key], minimum, maximum);
  if (numeric === null) return false;
  target[key] = numeric;
  return true;
}

function optionalBoolean(source: JsonObject, key: string, target: JsonObject): boolean {
  if (source[key] === undefined) return true;
  if (typeof source[key] !== "boolean") return false;
  target[key] = source[key];
  return true;
}

function optionalSlug(source: JsonObject, key: string, target: JsonObject): boolean {
  if (source[key] === undefined) return true;
  const value = cleanText(source[key], 32);
  if (!value || !SLUG_PATTERN.test(value)) return false;
  target[key] = value;
  return true;
}

export function sanitizeProfile(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const displayName = cleanText(value.displayName ?? value.name, 20);
  if (!displayName) return null;
  const profile: JsonObject = { displayName };
  if (!optionalSlug(value, "cosmetic", profile)) return null;
  if (!optionalSlug(value, "character", profile)) return null;
  if (!optionalSlug(value, "instrument", profile)) return null;
  if (!optionalInteger(value, "rating", profile, 0, 5000)) return null;
  return profile;
}

function sanitizeRoomEntry(type: ClientMessageType, payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  if (type === "room-create") {
    if (!optionalBoolean(payload, "public", result)) return null;
    if (!optionalInteger(payload, "limit", result, 2, 4)) return null;
    if (!optionalSlug(payload, "mode", result)) return null;
  }
  if (payload.profile !== undefined) {
    const profile = sanitizeProfile(payload.profile);
    if (!profile) return null;
    result.profile = profile;
  }
  const token = optionalText(payload.reconnectToken ?? payload.token, 128);
  if (token === null || (token !== undefined && !RECONNECT_TOKEN_PATTERN.test(token))) return null;
  if (token !== undefined) result.reconnectToken = token;
  return result;
}

function sanitizeSelection(type: ClientMessageType, payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  if (type === "player-ready") {
    if (typeof payload.ready !== "boolean") return null;
    result.ready = payload.ready;
    if (!optionalSlug(payload, "instrument", result)) return null;
    return result;
  }
  const key = type.slice("select-".length);
  const raw = payload[key] ?? payload.value;
  if (key === "team") {
    const team = cleanText(raw, 12);
    if (!team || !TEAM_PATTERN.test(team)) return null;
    result.team = team.toLowerCase();
    return result;
  }
  const selected = cleanText(raw, 32);
  if (!selected || !SLUG_PATTERN.test(selected)) return null;
  result[key] = selected;
  return result;
}

function sanitizeInput(payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  if (!optionalInteger(payload, "seq", result, 0, 2_147_483_647)) return null;
  if (!optionalInteger(payload, "tick", result, 0, 2_147_483_647)) return null;
  if (!optionalNumber(payload, "dt", result, 0, 0.25)) return null;

  if (payload.axes !== undefined) {
    if (!isObject(payload.axes)) return null;
    const axes: JsonObject = {};
    if (!optionalNumber(payload.axes, "x", axes, -1, 1)) return null;
    if (!optionalNumber(payload.axes, "y", axes, -1, 1)) return null;
    result.axes = axes;
  }
  if (payload.buttons !== undefined) {
    if (!Array.isArray(payload.buttons) || payload.buttons.length > INPUT_BUTTONS.size) return null;
    const buttons: string[] = [];
    for (const button of payload.buttons) {
      if (typeof button !== "string" || !INPUT_BUTTONS.has(button)) return null;
      if (!buttons.includes(button)) buttons.push(button);
    }
    result.buttons = buttons;
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

function sanitizeArenaInput(payload: JsonObject): JsonObject | null {
  const matchId = cleanText(payload.matchId, 48);
  const sequence = boundedInteger(payload.seq, 1, 2_147_483_647);
  const x = boundedNumber(payload.x, -1, 1);
  const y = boundedNumber(payload.y, -1, 1);
  if (!matchId || !MATCH_ID_PATTERN.test(matchId) || sequence === null || x === null || y === null ||
      typeof payload.guard !== "boolean") return null;
  const result: JsonObject = { matchId, seq: sequence, x, y, guard: payload.guard };
  if (payload.action === null || payload.action === undefined) {
    result.action = null;
    return result;
  }
  if (!isObject(payload.action)) return null;
  const actionType = cleanText(payload.action.type, 16);
  const actionSequence = boundedInteger(payload.action.seq, 1, 2_147_483_647);
  const actionX = boundedNumber(payload.action.x, -1, 1);
  const actionY = boundedNumber(payload.action.y, -1, 1);
  if (!actionType || !FIGHTER_ACTIONS.has(actionType) || actionSequence === null ||
      actionX === null || actionY === null) return null;
  const action: JsonObject = {
    seq: actionSequence,
    type: actionType,
    x: actionX,
    y: actionY,
  };
  if (payload.action.sentAt !== undefined) {
    const sentAt = boundedNumber(payload.action.sentAt, 0, Number.MAX_SAFE_INTEGER);
    if (sentAt === null) return null;
    action.sentAt = sentAt;
  }
  result.action = action;
  return result;
}

function sanitizeWorldSnapshot(payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  for (const [key, minimum, maximum] of [
    ["x", -1_000_000, 1_000_000],
    ["y", -1_000_000, 1_000_000],
    ["facing", -7, 7],
  ] as const) {
    if (!optionalNumber(payload, key, result, minimum, maximum)) return null;
  }
  for (const [key, minimum, maximum] of [
    ["stage", 1, 32],
    ["quests", 0, 9999],
    ["bosses", 0, 999],
  ] as const) {
    if (!optionalInteger(payload, key, result, minimum, maximum)) return null;
  }
  for (const key of ["moving", "attacking", "odin"] as const) {
    if (!optionalBoolean(payload, key, result)) return null;
  }
  if (!optionalSlug(payload, "instrument", result)) return null;
  // Empty means "no active resonance" in older cached game clients. Accept it
  // explicitly so a harmless optional field cannot disconnect a whole lobby.
  if (payload.resonance === "") result.resonance = "";
  else if (!optionalSlug(payload, "resonance", result)) return null;
  if (payload.equipment !== undefined) {
    const equipment = sanitizeEquipmentSnapshot(payload.equipment);
    if (!equipment) return null;
    result.equipment = equipment;
  }
  if (result.x === undefined || result.y === undefined) return null;
  return result;
}

function sanitizeEquipmentSnapshot(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const equipmentId = cleanText(value.equipmentId, 16);
  const animationState = cleanText(value.animationState, 16);
  const facingDirection = cleanText(value.facingDirection, 8);
  const switchFrom = cleanText(value.switchFrom, 16);
  const switchTo = cleanText(value.switchTo, 16);
  const animationFrame = boundedInteger(value.animationFrame, 0, 15);
  const animationElapsed = boundedNumber(value.animationElapsed, 0, 86_400);
  const animationTimestamp = boundedInteger(value.animationTimestamp, 0, 9_999_999_999_999);
  const networkStateId = boundedInteger(value.networkStateId, 0, 15);
  const schemaVersion = boundedInteger(value.schemaVersion, 0, 1);
  const switchProgress = boundedNumber(value.switchProgress, 0, 1);
  const switchDuration = boundedNumber(value.switchDuration, 0.2, 2);
  if (!equipmentId || !EQUIPMENT_IDS.has(equipmentId) ||
      !animationState || !EQUIPMENT_STATES.has(animationState) ||
      !facingDirection || !EQUIPMENT_DIRECTIONS.has(facingDirection) ||
      !switchFrom || !EQUIPMENT_IDS.has(switchFrom) ||
      !switchTo || !EQUIPMENT_IDS.has(switchTo) ||
      animationFrame === null || animationElapsed === null || animationTimestamp === null ||
      networkStateId === null || schemaVersion === null || switchProgress === null || switchDuration === null ||
      value.cosmeticVariant !== "standard" || typeof value.legendary !== "boolean" ||
      typeof value.switching !== "boolean") return null;
  return {
    equipmentId, animationState, animationFrame, animationElapsed, animationTimestamp,
    facingDirection, networkStateId, cosmeticVariant: "standard", schemaVersion,
    legendary: value.legendary, switching: value.switching,
    switchFrom, switchTo, switchProgress, switchDuration,
  };
}

function sanitizeArenaState(payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  if (!optionalSlug(payload, "mode", result)) return null;
  for (const [key, minimum, maximum] of [
    ["x", -100_000, 100_000],
    ["y", -100_000, 100_000],
    ["vx", -5000, 5000],
    ["vy", -5000, 5000],
    ["facing", -7, 7],
    ["hp", 0, 999],
    ["damage", 0, 999],
    ["score", -9999, 999_999],
  ] as const) {
    if (!optionalNumber(payload, key, result, minimum, maximum)) return null;
  }
  for (const key of ["starting", "dodge", "attack", "blocking", "grounded"] as const) {
    if (!optionalBoolean(payload, key, result)) return null;
  }
  if (payload.x === undefined || payload.y === undefined) return null;
  return result;
}

function sanitizePlayerStates(payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  if (!optionalInteger(payload, "tick", result, 0, 2_147_483_647)) return null;
  if (!optionalInteger(payload, "seq", result, 0, 2_147_483_647)) return null;
  if (!optionalNumber(payload, "timer", result, 0, 86_400_000)) return null;
  if (payload.players !== undefined) {
    if (!Array.isArray(payload.players) || payload.players.length > 4) return null;
    const players: JsonObject[] = [];
    for (const rawPlayer of payload.players) {
      if (!isObject(rawPlayer) || !PLAYER_ID_PATTERN.test(String(rawPlayer.id ?? ""))) return null;
      const state = sanitizeArenaState(rawPlayer);
      if (!state) return null;
      state.id = rawPlayer.id;
      players.push(state);
    }
    result.players = players;
  }
  if (payload.scores !== undefined) {
    if (!isObject(payload.scores) || Object.keys(payload.scores).length > 4) return null;
    const scores: Record<string, number> = {};
    for (const [id, rawScore] of Object.entries(payload.scores)) {
      const score = boundedInteger(rawScore, -9999, 999_999);
      if (!PLAYER_ID_PATTERN.test(id) || score === null) return null;
      scores[id] = score;
    }
    result.scores = scores;
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

function sanitizeAction(type: ClientMessageType, payload: JsonObject): JsonObject | null {
  const result: JsonObject = {};
  const target = optionalText(payload.target, 12);
  if (target === null || (target !== undefined && !PLAYER_ID_PATTERN.test(target))) return null;
  if (target !== undefined) result.target = target;
  for (const [key, minimum, maximum] of [
    ["x", -100_000, 100_000],
    ["y", -100_000, 100_000],
    ["vx", -5000, 5000],
    ["vy", -5000, 5000],
    ["angle", -7, 7],
    ["power", 0, 100],
    ["damage", 0, 100],
    ["knockback", 0, 5000],
  ] as const) {
    if (!optionalNumber(payload, key, result, minimum, maximum)) return null;
  }
  for (const key of ["attackId", "ability", "reason"] as const) {
    const text = optionalText(payload[key], 32);
    if (text === null) return null;
    if (text !== undefined) result[key] = text;
  }
  if (!optionalInteger(payload, "seq", result, 0, 2_147_483_647)) return null;
  if (!optionalInteger(payload, "tick", result, 0, 2_147_483_647)) return null;
  if (type === "arena-hit" && (target === undefined || result.damage === undefined)) return null;
  return result;
}

function sanitizeMatchStart(payload: JsonObject): JsonObject | null {
  const matchId = cleanText(payload.matchId, 48);
  const mode = cleanText(payload.mode, 32);
  const stage = cleanText(payload.stage, 32);
  const stocks = boundedInteger(payload.stocks, 1, 5);
  const duration = boundedInteger(payload.duration, 30, 600);
  const startAt = boundedInteger(payload.startAt, 0, Number.MAX_SAFE_INTEGER);
  if (!matchId || !MATCH_ID_PATTERN.test(matchId) || !mode || !SLUG_PATTERN.test(mode) ||
      !stage || !SLUG_PATTERN.test(stage) || stocks === null || duration === null || startAt === null ||
      !Array.isArray(payload.players) || payload.players.length < 2 || payload.players.length > 4) return null;
  const players: JsonObject[] = [];
  const seen = new Set<string>();
  for (const rawPlayer of payload.players) {
    if (!isObject(rawPlayer)) return null;
    const id = cleanText(rawPlayer.id, 12);
    const name = cleanText(rawPlayer.name, 18);
    const instrument = cleanText(rawPlayer.instrument, 32);
    const colour = typeof rawPlayer.colour === "string" && /^#[0-9a-f]{6}$/i.test(rawPlayer.colour)
      ? rawPlayer.colour.toLowerCase()
      : null;
    if (!id || !PLAYER_ID_PATTERN.test(id) || seen.has(id) || !name || !instrument ||
        !SLUG_PATTERN.test(instrument) || !colour) return null;
    seen.add(id);
    players.push({ id, name, instrument, colour });
  }
  const result: JsonObject = { matchId, mode, stage, stocks, duration, startAt, players };
  const seed = optionalText(payload.seed, 64);
  if (seed === null) return null;
  if (seed !== undefined) result.seed = seed;
  return result;
}

function sanitizeArenaSnapshot(payload: JsonObject): JsonObject | null {
  const matchId = cleanText(payload.matchId, 48);
  const sequence = boundedInteger(payload.seq, 1, 2_147_483_647);
  const time = boundedNumber(payload.time, 0, 3600);
  const phase = cleanText(payload.phase, 16);
  if (!matchId || !MATCH_ID_PATTERN.test(matchId) || sequence === null || time === null ||
      !phase || !MATCH_PHASES.has(phase) || !Array.isArray(payload.fighters) ||
      payload.fighters.length < 2 || payload.fighters.length > 4 ||
      !Array.isArray(payload.projectiles) || payload.projectiles.length > 24) return null;

  const fighters: JsonObject[] = [];
  const fighterIds = new Set<string>();
  for (const rawFighter of payload.fighters) {
    if (!isObject(rawFighter)) return null;
    const id = cleanText(rawFighter.id, 12);
    const x = boundedNumber(rawFighter.x, -2000, 3000);
    const y = boundedNumber(rawFighter.y, -2000, 3000);
    const vx = boundedNumber(rawFighter.vx, -5000, 5000);
    const vy = boundedNumber(rawFighter.vy, -5000, 5000);
    const facing = boundedNumber(rawFighter.facing, -1, 1);
    const damage = boundedNumber(rawFighter.damage, 0, 999);
    const stocks = boundedInteger(rawFighter.stocks, 0, 5);
    const guard = boundedNumber(rawFighter.guard, 0, 250);
    const invuln = boundedNumber(rawFighter.invuln, 0, 5);
    const hitstun = boundedNumber(rawFighter.hitstun, 0, 5);
    const respawn = boundedNumber(rawFighter.respawn, 0, 5);
    const ultimate = boundedNumber(rawFighter.ultimate, 0, 100);
    const attackTime = boundedNumber(rawFighter.attackTime, 0, 5);
    const knockouts = boundedInteger(rawFighter.knockouts, 0, 99);
    const falls = boundedInteger(rawFighter.falls, 0, 99);
    const disconnected = rawFighter.disconnected === true;
    const attackHits = sanitizeFighterOwnerIds(rawFighter.attackHits);
    const attack = rawFighter.attack === "" ? "" : cleanText(rawFighter.attack, 40);
    if (!id || !PLAYER_ID_PATTERN.test(id) || fighterIds.has(id) || x === null || y === null ||
        vx === null || vy === null || facing === null || damage === null || stocks === null ||
        guard === null || invuln === null || hitstun === null || respawn === null || ultimate === null ||
        attackTime === null || knockouts === null || falls === null || attack === null || attackHits === null) return null;
    fighterIds.add(id);
    fighters.push({
      id, x, y, vx, vy, facing, damage, stocks, guard, invuln, hitstun, respawn,
      ultimate, attack, attackTime, attackHits, knockouts, falls, disconnected,
    });
  }

  const projectiles: JsonObject[] = [];
  const projectileIds = new Set<string>();
  for (const rawProjectile of payload.projectiles) {
    if (!isObject(rawProjectile)) return null;
    const id = cleanText(rawProjectile.id, 48);
    const owner = cleanText(rawProjectile.owner, 48);
    const x = boundedNumber(rawProjectile.x, -2000, 3000);
    const y = boundedNumber(rawProjectile.y, -2000, 3000);
    const vx = boundedNumber(rawProjectile.vx, -1000, 1000);
    const life = boundedNumber(rawProjectile.life, 0, 5);
    const radius = boundedNumber(rawProjectile.radius, 1, 50);
    const move = rawProjectile.move === undefined || rawProjectile.move === ""
      ? ""
      : cleanText(rawProjectile.move, 40);
    const hits = sanitizeFighterOwnerIds(rawProjectile.hits);
    const colour = typeof rawProjectile.colour === "string" && /^#[0-9a-f]{6}$/i.test(rawProjectile.colour)
      ? rawProjectile.colour.toLowerCase()
      : null;
    if (!id || projectileIds.has(id) || !owner || !FIGHTER_OWNER_PATTERN.test(owner) ||
        x === null || y === null || vx === null ||
        life === null || radius === null || !colour || move === null || hits === null) return null;
    projectileIds.add(id);
    projectiles.push({ id, owner, x, y, vx, life, radius, colour, move, hits });
  }
  return { matchId, seq: sequence, time, phase, fighters, projectiles };
}

function sanitizeMatchEnd(payload: JsonObject): JsonObject | null {
  const matchId = cleanText(payload.matchId, 48);
  if (!matchId || !MATCH_ID_PATTERN.test(matchId)) return null;
  const result: JsonObject = { matchId };
  if (payload.winner !== undefined) {
    if (payload.winner === "") result.winner = "";
    else {
      const winner = cleanText(payload.winner, 12);
      if (!winner || !PLAYER_ID_PATTERN.test(winner)) return null;
      result.winner = winner;
    }
  }
  if (payload.abandonedBy !== undefined) {
    const abandonedBy = cleanText(payload.abandonedBy, 12);
    if (!abandonedBy || !PLAYER_ID_PATTERN.test(abandonedBy)) return null;
    result.abandonedBy = abandonedBy;
  }
  const reason = optionalText(payload.reason, 24);
  if (reason === null) return null;
  if (reason !== undefined) result.reason = reason;
  else if (result.abandonedBy) result.reason = "disconnect";
  if (payload.fighters !== undefined) {
    if (!Array.isArray(payload.fighters) || payload.fighters.length < 2 || payload.fighters.length > 4) return null;
    const fighters: JsonObject[] = [];
    const seen = new Set<string>();
    for (const rawFighter of payload.fighters) {
      if (!isObject(rawFighter)) return null;
      const id = cleanText(rawFighter.id, 12);
      const stocks = boundedInteger(rawFighter.stocks, 0, 5);
      const damage = boundedNumber(rawFighter.damage, 0, 999);
      const knockouts = boundedInteger(rawFighter.knockouts, 0, 99);
      if (!id || !PLAYER_ID_PATTERN.test(id) || seen.has(id) || stocks === null ||
          damage === null || knockouts === null) return null;
      seen.add(id);
      fighters.push({ id, stocks, damage, knockouts });
    }
    result.fighters = fighters;
  }
  return result;
}

function sanitizePayload(type: ClientMessageType, payload: JsonObject): JsonObject | null {
  if (["hello", "room-create", "room-join", "reconnect"].includes(type)) {
    return sanitizeRoomEntry(type, payload);
  }
  if (type === "room-sync") return {};
  if (type === "room-leave") return {};
  if (type === "room-advertise") {
    const result: JsonObject = {};
    if (!optionalBoolean(payload, "public", result)) return null;
    if (!optionalInteger(payload, "players", result, 0, 4)) return null;
    if (!optionalInteger(payload, "limit", result, 2, 4)) return null;
    if (!optionalSlug(payload, "mode", result)) return null;
    const profile = payload.profile === undefined ? undefined : sanitizeProfile(payload.profile);
    if (profile === null) return null;
    if (profile !== undefined) result.profile = profile;
    return result;
  }
  if (["player-ready", "select-character", "select-instrument", "select-stage", "select-team"].includes(type)) {
    return sanitizeSelection(type, payload);
  }
  if (type === "profile") return sanitizeProfile(payload.profile ?? payload);
  if (type === "match-start" || type === "rematch") return sanitizeMatchStart(payload);
  if (type === "input") return sanitizeInput(payload);
  if (type === "arena-input") return sanitizeArenaInput(payload);
  if (type === "snapshot") return sanitizeWorldSnapshot(payload);
  if (type === "arena-state") return sanitizeArenaState(payload);
  if (type === "arena-snapshot") return sanitizeArenaSnapshot(payload);
  if (["state-snapshot", "state-correction", "score-update"].includes(type)) {
    return sanitizePlayerStates(payload);
  }
  if ([
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
  ].includes(type)) {
    return sanitizeAction(type, payload);
  }
  if (type === "match-end") return sanitizeMatchEnd(payload);
  if (type === "world-ping") {
    const result: JsonObject = {};
    if (!optionalNumber(payload, "x", result, -1_000_000, 1_000_000)) return null;
    if (!optionalNumber(payload, "y", result, -1_000_000, 1_000_000)) return null;
    if (!optionalInteger(payload, "stage", result, 1, 32)) return null;
    const id = optionalText(payload.id, 64);
    const label = optionalText(payload.label, 24);
    if (id === null || label === null) return null;
    if (id !== undefined) result.id = id;
    if (label !== undefined) result.label = label;
    if (payload.color !== undefined) {
      if (typeof payload.color !== "string" || !/^#[0-9a-f]{6}$/i.test(payload.color)) return null;
      result.color = payload.color.toLowerCase();
    }
    return result;
  }
  if (type === "chat") {
    const text = cleanText(payload.text, 120);
    return text ? { text } : null;
  }
  if (type === "emote") {
    return typeof payload.emote === "string" && EMOTES.has(payload.emote)
      ? { emote: payload.emote }
      : null;
  }
  if (type === "ping" || type === "pong") {
    const result: JsonObject = {};
    if (!optionalNumber(payload, "stamp", result, 0, Number.MAX_SAFE_INTEGER)) return null;
    const target = optionalText(payload.target, 12);
    if (target === null || (target !== undefined && !PLAYER_ID_PATTERN.test(target))) return null;
    if (target !== undefined) result.target = target;
    return result;
  }
  if (type === "room-welcome" || type === "room-reject") {
    const result: JsonObject = {};
    const target = cleanText(payload.target, 12);
    if (!target || !PLAYER_ID_PATTERN.test(target)) return null;
    result.target = target;
    const reason = optionalText(payload.reason, 32);
    if (reason === null) return null;
    if (reason !== undefined) result.reason = reason;
    return result;
  }
  return null;
}

function frameToText(frame: string | ArrayBuffer, maximumBytes: number): ValidationResult<string> {
  if (typeof frame === "string") {
    const bytes = new TextEncoder().encode(frame).byteLength;
    if (bytes > maximumBytes) return failure("message_too_large", "Message exceeds the byte limit.");
    return { ok: true, value: frame, bytes };
  }
  if (frame.byteLength > maximumBytes) {
    return failure("message_too_large", "Message exceeds the byte limit.");
  }
  return failure("binary_not_supported", "Send versioned JSON as a text WebSocket frame.");
}

export function validateClientFrame(
  frame: string | ArrayBuffer,
  expectedRoom: string,
  maximumBytes = MAX_MESSAGE_BYTES,
): ValidationResult<ValidatedEnvelope> {
  const text = frameToText(frame, maximumBytes);
  if (!text.ok) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    return failure("malformed_json", "Message must be valid JSON.");
  }
  if (!isObject(parsed)) return failure("invalid_envelope", "Message must be a JSON object.");
  const allowedKeys = new Set(["v", "type", "from", "room", "payload", "ts", "seq", "id"]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    return failure("invalid_envelope", "Message contains unsupported envelope fields.");
  }
  if (parsed.v !== NETWORK_PROTOCOL_VERSION) {
    return failure(
      "protocol_mismatch",
      `Protocol ${String(parsed.v)} is incompatible; expected ${NETWORK_PROTOCOL_VERSION}.`,
    );
  }
  if (typeof parsed.type !== "string") return failure("invalid_type", "Message type is required.");
  const canonicalType = canonicalMessageType(parsed.type);
  if (!canonicalType) return failure("unsupported_type", "Message type is not supported.");
  if (typeof parsed.from !== "string" || !PLAYER_ID_PATTERN.test(parsed.from)) {
    return failure("invalid_identity", "Player identity must be 12 uppercase letters or digits.");
  }
  if (typeof parsed.room !== "string") return failure("invalid_room", "Room code is required.");
  const roomMayBeEmpty = canonicalType === "hello" || canonicalType === "reconnect";
  if (parsed.room !== expectedRoom && !(roomMayBeEmpty && parsed.room === "")) {
    return failure("room_mismatch", "Message room does not match this connection.");
  }
  if (parsed.room && !ROOM_CODE_PATTERN.test(parsed.room)) {
    return failure("invalid_room", "Room code is invalid.");
  }
  if (!isObject(parsed.payload)) return failure("invalid_payload", "Payload must be a JSON object.");
  const payload = sanitizePayload(canonicalType, parsed.payload);
  if (!payload) return failure("invalid_payload", `Payload for ${parsed.type} is invalid.`);
  const timestamp = boundedInteger(parsed.ts, 0, Number.MAX_SAFE_INTEGER);
  if (timestamp === null) return failure("invalid_timestamp", "Timestamp must be a positive integer.");
  const sequence = parsed.seq === undefined
    ? undefined
    : boundedInteger(parsed.seq, 0, 2_147_483_647);
  if (parsed.seq !== undefined && sequence === null) {
    return failure("invalid_sequence", "Sequence must be a non-negative integer.");
  }
  let messageId: string | undefined;
  if (parsed.id !== undefined) {
    if (typeof parsed.id !== "string" || parsed.id.length < 1 || parsed.id.length > 80 ||
        !/^[A-Za-z0-9._:-]+$/.test(parsed.id)) {
      return failure("invalid_message_id", "Message ID contains unsupported characters.");
    }
    messageId = parsed.id;
  }

  const value: ValidatedEnvelope = {
    v: NETWORK_PROTOCOL_VERSION,
    type: parsed.type,
    canonicalType,
    from: parsed.from,
    room: parsed.room || expectedRoom,
    payload,
    ts: timestamp,
  };
  if (sequence !== undefined && sequence !== null) value.seq = sequence;
  if (messageId !== undefined) value.id = messageId;
  return { ok: true, value, bytes: text.bytes };
}

export function validateRoomCode(value: string | null): string | null {
  if (!value) return null;
  const room = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(room) ? room : null;
}

export function validatePlayerId(value: string | null): string | null {
  if (!value) return null;
  const playerId = value.trim().toUpperCase();
  return PLAYER_ID_PATTERN.test(playerId) ? playerId : null;
}

export function validateReconnectToken(value: string | null): string | null {
  if (!value) return null;
  return RECONNECT_TOKEN_PATTERN.test(value) ? value : null;
}

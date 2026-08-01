import type { ClientMessageType } from "./protocol";

export interface WindowCounter {
  startedAt: number;
  used: number;
}

export interface ConnectionRateState {
  messages: WindowCounter;
  bytes: WindowCounter;
  byType: Partial<Record<ClientMessageType, WindowCounter>>;
  strikes: number;
  lastStrikeAt: number;
}

export interface RateLimitConfig {
  maxMessagesPerSecond: number;
  maxBytesPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "message_rate" | "bandwidth" | "type_rate";
  retryAfterMs?: number;
}

interface TypeLimit {
  count: number;
  windowMs: number;
}

const TYPE_LIMITS: Partial<Record<ClientMessageType, TypeLimit>> = {
  chat: { count: 4, windowMs: 5000 },
  emote: { count: 6, windowMs: 5000 },
  "world-ping": { count: 2, windowMs: 3000 },
  snapshot: { count: 35, windowMs: 1000 },
  "arena-state": { count: 35, windowMs: 1000 },
  "arena-input": { count: 35, windowMs: 1000 },
  "arena-snapshot": { count: 20, windowMs: 1000 },
  input: { count: 35, windowMs: 1000 },
  attack: { count: 20, windowMs: 1000 },
  block: { count: 20, windowMs: 1000 },
  dodge: { count: 12, windowMs: 1000 },
  jump: { count: 12, windowMs: 1000 },
  ability: { count: 12, windowMs: 1000 },
  "arena-hit": { count: 12, windowMs: 1000 },
  ping: { count: 4, windowMs: 5000 },
  pong: { count: 6, windowMs: 5000 },
};

export function createRateState(now = Date.now()): ConnectionRateState {
  return {
    messages: { startedAt: now, used: 0 },
    bytes: { startedAt: now, used: 0 },
    byType: {},
    strikes: 0,
    lastStrikeAt: 0,
  };
}

function consumeWindow(
  counter: WindowCounter,
  now: number,
  amount: number,
  maximum: number,
  windowMs: number,
): RateLimitResult {
  if (now - counter.startedAt >= windowMs || now < counter.startedAt) {
    counter.startedAt = now;
    counter.used = 0;
  }
  if (counter.used + amount > maximum) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1, windowMs - (now - counter.startedAt)),
    };
  }
  counter.used += amount;
  return { allowed: true };
}

export function consumeRateLimit(
  state: ConnectionRateState,
  now: number,
  bytes: number,
  type: ClientMessageType,
  config: RateLimitConfig,
): RateLimitResult {
  if (state.lastStrikeAt && now - state.lastStrikeAt > 30_000) state.strikes = 0;

  const messageResult = consumeWindow(
    state.messages,
    now,
    1,
    config.maxMessagesPerSecond,
    1000,
  );
  if (!messageResult.allowed) return { ...messageResult, reason: "message_rate" };

  const byteResult = consumeWindow(state.bytes, now, bytes, config.maxBytesPerSecond, 1000);
  if (!byteResult.allowed) return { ...byteResult, reason: "bandwidth" };

  const limit = TYPE_LIMITS[type];
  if (!limit) return { allowed: true };
  const counter = state.byType[type] ?? { startedAt: now, used: 0 };
  state.byType[type] = counter;
  const typeResult = consumeWindow(counter, now, 1, limit.count, limit.windowMs);
  if (!typeResult.allowed) return { ...typeResult, reason: "type_rate" };
  return { allowed: true };
}

export function registerRateStrike(state: ConnectionRateState, now: number): number {
  state.strikes += 1;
  state.lastStrikeAt = now;
  return state.strikes;
}

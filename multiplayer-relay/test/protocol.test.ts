import { describe, expect, it } from "vitest";
import { NETWORK_PROTOCOL_VERSION } from "../src/protocol";
import { validateClientFrame } from "../src/validation";

const ROOM = "ABC234";
const PLAYER = "PLAYER000001";

function packet(type: string, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: NETWORK_PROTOCOL_VERSION,
    type,
    from: PLAYER,
    room: ROOM,
    payload,
    ts: Date.now(),
    ...overrides,
  });
}

describe("versioned protocol validation", () => {
  it("accepts the shipped hyphenated room protocol", () => {
    const result = validateClientFrame(packet("room-create", {
      public: false,
      limit: 4,
      profile: { displayName: "Eems", cosmetic: "grove", rating: 1000 },
    }), ROOM);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canonicalType).toBe("room-create");
      expect(result.value.from).toBe(PLAYER);
    }
  });

  it("normalises V2 underscore aliases without rewriting the wire type", () => {
    const result = validateClientFrame(packet("select_instrument", { instrument: "electric-guitar" }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canonicalType).toBe("select-instrument");
      expect(result.value.type).toBe("select_instrument");
    }
  });

  it("rejects incompatible protocol versions with a clear code", () => {
    const result = validateClientFrame(packet("hello", {}, { v: 1, room: "" }), ROOM);
    expect(result).toMatchObject({ ok: false, code: "protocol_mismatch" });
  });

  it("rejects identity and room spoofing", () => {
    expect(validateClientFrame(packet("chat", { text: "hello" }, { from: "bad" }), ROOM))
      .toMatchObject({ ok: false, code: "invalid_identity" });
    expect(validateClientFrame(packet("chat", { text: "hello" }, { room: "ZZZ999" }), ROOM))
      .toMatchObject({ ok: false, code: "room_mismatch" });
  });

  it("sanitises chat markup before forwarding", () => {
    const result = validateClientFrame(packet("chat", { text: "<b>Hello</b>\u0000 grove" }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.payload.text).toBe("bHello/b grove");
  });

  it("validates existing co-op snapshots and arena events", () => {
    const snapshot = validateClientFrame(packet("snapshot", {
      x: 120.4,
      y: 420.1,
      facing: 1.2,
      moving: true,
      attacking: false,
      odin: true,
      stage: 1,
      instrument: "electric-guitar",
      resonance: "nature",
      quests: 3,
      bosses: 0,
      equipment: {
        equipmentId: "guitar",
        animationState: "switch",
        animationFrame: 4,
        animationElapsed: 0.3,
        animationTimestamp: Date.now(),
        facingDirection: "east",
        networkStateId: 13,
        cosmeticVariant: "standard",
        schemaVersion: 1,
        legendary: false,
        switching: true,
        switchFrom: "bass",
        switchTo: "guitar",
        switchProgress: 0.55,
        switchDuration: 0.58,
      },
    }), ROOM);
    const hit = validateClientFrame(packet("arena-hit", {
      target: "PLAYER000002",
      damage: 12,
      attackId: "HIT234",
    }), ROOM);
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) expect(snapshot.value.payload.equipment).toMatchObject({
      equipmentId: "guitar",
      animationState: "switch",
      facingDirection: "east",
      switchFrom: "bass",
      switchTo: "guitar",
      switchProgress: 0.55,
    });
    expect(hit.ok).toBe(true);
  });

  it("accepts the legacy empty value for no active resonance", () => {
    const result = validateClientFrame(packet("snapshot", {
      x: 120,
      y: 420,
      stage: 1,
      instrument: "guitar",
      resonance: "",
    }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.payload.resonance).toBe("");
  });

  it("preserves the shipped fighter match-start roster and message ID", () => {
    const result = validateClientFrame(packet("match-start", {
      matchId: "NABC234",
      mode: "stock",
      stage: "mossvale-amphitheatre",
      stocks: 3,
      duration: 180,
      startAt: Date.now() + 1450,
      players: [
        { id: PLAYER, name: "Eems", instrument: "guitar", colour: "#7df7a1" },
        { id: "PLAYER000002", name: "Guest", instrument: "bass", colour: "#ff9d57" },
      ],
    }, { id: `${PLAYER}-7-moss`, seq: 7 }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(`${PLAYER}-7-moss`);
      expect(result.value.payload.players).toHaveLength(2);
      expect(result.value.payload).toMatchObject({
        matchId: "NABC234",
        duration: 180,
        stocks: 3,
      });
    }
  });

  it("preserves the shipped 20 Hz arena input shape", () => {
    const result = validateClientFrame(packet("arena-input", {
      matchId: "NABC234",
      seq: 19,
      x: -0.75,
      y: 1,
      guard: true,
      action: { seq: 18, type: "special", x: -1, y: -1, sentAt: 2345.6 },
    }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toMatchObject({
        matchId: "NABC234",
        seq: 19,
        x: -0.75,
        y: 1,
        guard: true,
        action: { seq: 18, type: "special", x: -1, y: -1 },
      });
    }
  });

  it("preserves bounded authoritative fighter and projectile snapshots", () => {
    const fighter = (id: string, x: number) => ({
      id, x, y: 405, vx: 0, vy: 0, facing: 1, damage: 14.5, stocks: 3, guard: 92,
      invuln: 0, hitstun: 0, respawn: 0, ultimate: 25, attack: "guitar-forward",
      attackTime: 0.12, attackHits: id === PLAYER ? [`net-PLAYER000002`] : [],
      knockouts: 0, falls: 0, disconnected: id === "PLAYER000002",
    });
    const result = validateClientFrame(packet("arena-snapshot", {
      matchId: "NABC234",
      seq: 88,
      time: 172.25,
      phase: "playing",
      fighters: [fighter(PLAYER, 395), fighter("PLAYER000002", 805)],
      projectiles: [{
        id: "PABC234", owner: `net-${PLAYER}`, x: 430, y: 372, vx: 430,
        life: 1.15, radius: 12, colour: "#62c7ff", move: "guitar-special",
        hits: [`net-PLAYER000002`],
      }],
    }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const fighters = result.value.payload.fighters as Array<Record<string, unknown>>;
      const projectiles = result.value.payload.projectiles as Array<Record<string, unknown>>;
      expect(fighters).toHaveLength(2);
      expect(fighters[0]).toMatchObject({ attackHits: [`net-PLAYER000002`] });
      expect(fighters[1]).toMatchObject({ disconnected: true });
      expect(projectiles).toHaveLength(1);
      expect(result.value.payload).toMatchObject({ matchId: "NABC234", seq: 88, time: 172.25 });
      expect(projectiles[0]).toMatchObject({ move: "guitar-special", hits: [`net-PLAYER000002`] });
    }
  });

  it("rejects out-of-bounds fighter state and unbound projectile owner shapes", () => {
    const fighter = (id: string) => ({
      id, x: 395, y: 405, vx: 0, vy: 0, facing: 1, damage: 0, stocks: 3, guard: 100,
      invuln: 0, hitstun: 0, respawn: 0, ultimate: 0, attack: "", attackTime: 0,
      knockouts: 0, falls: 0,
    });
    const base = {
      matchId: "NABC234",
      seq: 89,
      time: 170,
      phase: "playing",
      fighters: [fighter(PLAYER), fighter("PLAYER000002")],
    };
    expect(validateClientFrame(packet("arena-snapshot", {
      ...base,
      fighters: [{ ...fighter(PLAYER), stocks: 99 }, fighter("PLAYER000002")],
      projectiles: [],
    }), ROOM)).toMatchObject({ ok: false, code: "invalid_payload" });
    expect(validateClientFrame(packet("arena-snapshot", {
      ...base,
      projectiles: [{
        id: "PABC234", owner: "floating-owner", x: 430, y: 372, vx: 430,
        life: 1.15, radius: 12, colour: "#62c7ff",
      }],
    }), ROOM)).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("preserves match IDs and casual result rows", () => {
    const result = validateClientFrame(packet("match-end", {
      matchId: "NABC234",
      winner: PLAYER,
      reason: "last-note",
      fighters: [
        { id: PLAYER, stocks: 2, damage: 84, knockouts: 1 },
        { id: "PLAYER000002", stocks: 0, damage: 148, knockouts: 0 },
      ],
    }), ROOM);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.payload).toMatchObject({
      matchId: "NABC234",
      winner: PLAYER,
      reason: "last-note",
    });
  });

  it("rejects oversized and binary packets", () => {
    const oversized = packet("chat", { text: "x".repeat(500) });
    expect(validateClientFrame(oversized, ROOM, 64)).toMatchObject({ ok: false, code: "message_too_large" });
    expect(validateClientFrame(new ArrayBuffer(4), ROOM)).toMatchObject({ ok: false, code: "binary_not_supported" });
  });
});

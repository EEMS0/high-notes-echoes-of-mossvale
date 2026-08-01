import { describe, expect, it } from "vitest";
import { createRoomCode, parseRelayRoute } from "../src/Matchmaker";
import type { RelayConfig } from "../src/config";
import { originAllowed, secureTransportAllowed } from "../src/security";

const config: RelayConfig = {
  environment: "production",
  allowedOrigins: new Set(["https://eems0.github.io"]),
  requireOrigin: true,
  maxRoomPlayers: 4,
  maxMessageBytes: 16_384,
  maxMessagesPerSecond: 45,
  maxBytesPerSecond: 98_304,
  reconnectGraceMs: 30_000,
  roomIdleTtlMs: 300_000,
};

describe("relay routing", () => {
  it("generates readable six-character room codes", () => {
    for (let index = 0; index < 30; index += 1) {
      expect(createRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it("accepts versioned and short websocket routes", () => {
    expect(parseRelayRoute(new URL("https://relay.test/v2/rooms/ABC234?intent=create&playerId=PLAYER000001")))
      .toMatchObject({ roomCode: "ABC234", intent: "create", playerId: "PLAYER000001" });
    expect(parseRelayRoute(new URL("https://relay.test/ws/ABC234?intent=join&playerId=PLAYER000002")))
      .toMatchObject({ roomCode: "ABC234", intent: "join" });
    expect(parseRelayRoute(new URL("https://relay.test/ws?room=ABC234")))
      .toMatchObject({ roomCode: "ABC234", intent: "connect" });
  });

  it("rejects invalid room, identity, intent, and reconnect tokens", () => {
    expect(parseRelayRoute(new URL("https://relay.test/v2/rooms/BAD"))).toBeNull();
    expect(parseRelayRoute(new URL("https://relay.test/v2/rooms/ABC234?intent=create&playerId=bad"))).toBeNull();
    expect(parseRelayRoute(new URL("https://relay.test/v2/rooms/ABC234?intent=ranked&playerId=PLAYER000001"))).toBeNull();
    expect(parseRelayRoute(new URL("https://relay.test/v2/rooms/ABC234?intent=reconnect&playerId=PLAYER000001"))).toBeNull();
  });

  it("enforces configured origins and secure production transport", () => {
    expect(originAllowed(new Request("https://relay.test", {
      headers: { Origin: "https://eems0.github.io" },
    }), config)).toBe(true);
    expect(originAllowed(new Request("https://relay.test", {
      headers: { Origin: "https://attacker.example" },
    }), config)).toBe(false);
    expect(secureTransportAllowed(new URL("https://relay.test"), config)).toBe(true);
    expect(secureTransportAllowed(new URL("http://relay.test"), config)).toBe(false);
    expect(secureTransportAllowed(new URL("http://localhost:8787"), config)).toBe(true);
  });
});

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker HTTP boundary", () => {
  it("reports health and protocol version", async () => {
    const before = Date.now();
    const response = await SELF.fetch(new Request("https://relay.test/health", {
      headers: { Origin: "https://eems0.github.io" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://eems0.github.io");
    expect(response.headers.get("Vary")).toContain("Origin");
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      service: "high-notes-v2-relay",
      protocolVersion: 2,
      publicMatchmaking: false,
      authorityModel: "host-authoritative-casual",
      networkTickRateHz: 20,
      snapshotRateHz: 10,
      maxRoomPlayers: 4,
      reconnectWindowMs: 30_000,
    });
    expect(typeof payload.timestamp).toBe("number");
    expect(Number(payload.timestamp)).toBeGreaterThanOrEqual(before);
    expect(payload).not.toHaveProperty("rooms");
    expect(payload).not.toHaveProperty("tokens");
  });

  it("does not grant browser read access to health from an unlisted origin", async () => {
    const response = await SELF.fetch(new Request("https://relay.test/health", {
      headers: { Origin: "https://attacker.example" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await SELF.fetch(new Request("https://relay.test/health", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    }));
    expect(preflight.status).toBe(403);
  });

  it("allocates a room code only for an allowed origin", async () => {
    const accepted = await SELF.fetch(new Request("https://relay.test/v2/rooms", {
      method: "POST",
      headers: { Origin: "https://eems0.github.io" },
    }));
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({ ok: true, protocolVersion: 2 });

    const rejected = await SELF.fetch(new Request("https://relay.test/v2/rooms", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }));
    expect(rejected.status).toBe(403);
  });

  it("rejects malformed routes before touching a room object", async () => {
    const response = await SELF.fetch(new Request("https://relay.test/v2/rooms/BAD", {
      headers: {
        Upgrade: "websocket",
        Origin: "https://eems0.github.io",
      },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_room_route" });
  });
});

import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

type WireMessage = {
  v: number;
  type: string;
  from: string;
  room: string;
  payload: Record<string, unknown>;
  ts: number;
};

class SocketInbox {
  readonly socket: WebSocket;
  private readonly queue: WireMessage[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      this.queue.push(JSON.parse(event.data) as WireMessage);
      for (const listener of this.listeners) listener();
    });
    socket.accept();
  }

  async next(type: string, timeoutMs = 2500): Promise<WireMessage> {
    const existing = this.queue.findIndex((message) => message.type === type);
    if (existing >= 0) return this.queue.splice(existing, 1)[0] as WireMessage;
    return new Promise<WireMessage>((resolve, reject) => {
      const onMessage = (): void => {
        const index = this.queue.findIndex((message) => message.type === type);
        if (index < 0) return;
        clearTimeout(timeout);
        this.listeners.delete(onMessage);
        resolve(this.queue.splice(index, 1)[0] as WireMessage);
      };
      const timeout = setTimeout(() => {
        this.listeners.delete(onMessage);
        reject(new Error(`Timed out waiting for ${type}; received ${this.queue.map((item) => item.type).join(", ")}`));
      }, timeoutMs);
      this.listeners.add(onMessage);
    });
  }
}

const openSockets: WebSocket[] = [];

async function connect(room: string, intent: string, playerId: string, token = ""): Promise<SocketInbox> {
  const suffix = token ? `&token=${encodeURIComponent(token)}` : "";
  const response = await SELF.fetch(new Request(
    `https://relay.test/v2/rooms/${room}?intent=${intent}&playerId=${playerId}${suffix}`,
    { headers: { Upgrade: "websocket", Origin: "https://eems0.github.io" } },
  ));
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket as WebSocket;
  openSockets.push(socket);
  return new SocketInbox(socket);
}

function clientPacket(
  room: string,
  from: string,
  type: string,
  payload: Record<string, unknown>,
): string {
  const sequence = Math.floor(Math.random() * 1_000_000) + 1;
  return JSON.stringify({
    v: 2,
    type,
    from,
    room,
    payload,
    ts: Date.now(),
    seq: sequence,
    id: `${from}-${sequence}-test`,
  });
}

afterEach(() => {
  while (openSockets.length) {
    const socket = openSockets.pop();
    if (socket && socket.readyState < 2) socket.close(1000, "test_complete");
  }
});

describe("Durable Object room sessions", () => {
  it("creates and joins a room with server-bound identities", async () => {
    const host = await connect("RMM223", "create", "PLAYER000001");
    const hostWelcome = await host.next("welcome");
    expect(hostWelcome.payload).toMatchObject({
      protocolVersion: 2,
      playerId: "PLAYER000001",
      joined: true,
      host: "PLAYER000001",
      publicMatchmaking: false,
    });
    expect(hostWelcome.payload.reconnectToken).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    await host.next("room-welcome");

    const guest = await connect("RMM223", "join", "PLAYER000002");
    expect((await guest.next("welcome")).payload).toMatchObject({
      playerId: "PLAYER000002",
      joined: true,
      host: "PLAYER000001",
    });
    const guestLobby = await guest.next("room-welcome");
    expect(guestLobby.payload.peers).toHaveLength(2);
    expect((await host.next("room-join")).from).toBe("PLAYER000002");
  });

  it("rejects a fifth player when a room is full", async () => {
    const players = ["PLAYER000011", "PLAYER000012", "PLAYER000013", "PLAYER000014"];
    for (let index = 0; index < players.length; index += 1) {
      const inbox = await connect("FULL23", index === 0 ? "create" : "join", players[index] as string);
      await inbox.next("welcome");
      await inbox.next("room-welcome");
    }
    const rejected = await connect("FULL23", "join", "PLAYER000015");
    expect((await rejected.next("error")).payload).toMatchObject({ code: "room_full", fatal: true });
    expect((await rejected.next("room-reject")).payload).toMatchObject({ reason: "room_full" });
  });

  it("closes an identity-spoofing socket", async () => {
    const host = await connect("SAFE23", "create", "PLAYER000021");
    await host.next("welcome");
    await host.next("room-welcome");
    host.socket.send(clientPacket("SAFE23", "PLAYER000022", "chat", { text: "spoof" }));
    expect((await host.next("error")).payload).toMatchObject({ code: "identity_spoof", fatal: true });
  });

  it("migrates the host and permits token-authenticated reconnection", async () => {
    const host = await connect("MSS223", "create", "PLAYER000031");
    const hostWelcome = await host.next("welcome");
    const reconnectToken = String(hostWelcome.payload.reconnectToken);
    await host.next("room-welcome");
    const guest = await connect("MSS223", "join", "PLAYER000032");
    await guest.next("welcome");
    await guest.next("room-welcome");
    await host.next("room-join");

    host.socket.close(1000, "network_change");
    expect((await guest.next("room-leave")).payload).toMatchObject({
      temporary: true,
      reason: "disconnected",
    });
    expect((await guest.next("host-migrate")).payload).toMatchObject({ host: "PLAYER000032" });

    const restored = await connect("MSS223", "reconnect", "PLAYER000031", reconnectToken);
    expect((await restored.next("welcome")).payload).toMatchObject({
      playerId: "PLAYER000031",
      reconnected: true,
      joined: true,
      host: "PLAYER000032",
    });
    await restored.next("room-welcome");
    expect((await guest.next("room-join")).payload).toMatchObject({ reconnected: true });
  });

  it("relays the shipped fighter match packets through host authority", async () => {
    const room = "BTTL23";
    const hostId = "PLAYER000041";
    const guestId = "PLAYER000042";
    const host = await connect(room, "create", hostId);
    await host.next("welcome");
    await host.next("room-welcome");
    const guest = await connect(room, "join", guestId);
    await guest.next("welcome");
    await guest.next("room-welcome");
    await host.next("room-join");

    host.socket.send(clientPacket(room, hostId, "player-ready", { ready: true, instrument: "guitar" }));
    expect((await guest.next("player-ready")).payload).toMatchObject({ ready: true, instrument: "guitar" });
    guest.socket.send(clientPacket(room, guestId, "player-ready", { ready: true, instrument: "bass" }));
    await host.next("player-ready");

    const roster = [
      { id: hostId, name: "Host", instrument: "guitar", colour: "#7df7a1" },
      { id: guestId, name: "Guest", instrument: "bass", colour: "#ff9d57" },
    ];
    const startPayload = {
      matchId: "NBATTLE23",
      mode: "stock",
      stage: "mossvale-amphitheatre",
      stocks: 3,
      duration: 180,
      startAt: Date.now() + 1450,
      players: roster,
    };
    host.socket.send(clientPacket(room, hostId, "match-start", startPayload));
    expect((await host.next("match-start")).payload).toMatchObject({
      matchId: "NBATTLE23",
      mode: "stock",
    });
    expect((await guest.next("match-start")).payload).toMatchObject({
      matchId: "NBATTLE23",
      mode: "stock",
      stocks: 3,
      players: roster,
    });

    guest.socket.send(clientPacket(room, guestId, "room-sync", {}));
    expect((await guest.next("room-welcome")).payload).toMatchObject({
      match: {
        phase: "playing",
        matchId: "NBATTLE23",
        roster: [hostId, guestId],
      },
    });

    guest.socket.send(clientPacket(room, guestId, "arena-input", {
      matchId: "NBATTLE23",
      seq: 1,
      x: -1,
      y: 0,
      guard: false,
      action: { seq: 1, type: "attack", x: -1, y: 0, sentAt: 1200 },
    }));
    expect((await host.next("arena-input")).payload).toMatchObject({
      matchId: "NBATTLE23",
      seq: 1,
      x: -1,
      action: { type: "attack", seq: 1 },
    });

    const fighter = (id: string, x: number) => ({
      id, x, y: 405, vx: 0, vy: 0, facing: 1, damage: 0, stocks: 3, guard: 100,
      invuln: 0, hitstun: 0, respawn: 0, ultimate: 0, attack: "", attackTime: 0,
      attackHits: [], knockouts: 0, falls: 0, disconnected: false,
    });
    const snapshotPayload = {
      matchId: "NBATTLE23",
      seq: 1,
      time: 179.4,
      phase: "playing",
      fighters: [fighter(hostId, 395), fighter(guestId, 805)],
      projectiles: [],
    };

    guest.socket.send(clientPacket(room, guestId, "arena-snapshot", snapshotPayload));
    expect((await guest.next("error")).payload).toMatchObject({ code: "host_only" });

    host.socket.send(clientPacket(room, hostId, "arena-input", {
      matchId: "NBATTLE23",
      seq: 1,
      x: 1,
      y: 0,
      guard: false,
      action: null,
    }));
    expect((await host.next("error")).payload).toMatchObject({ code: "host_input_rejected" });

    const lateJoin = await connect(room, "join", "PLAYER000043");
    expect((await lateJoin.next("error")).payload).toMatchObject({
      code: "match_in_progress",
      fatal: true,
    });

    host.socket.send(clientPacket(room, hostId, "arena-snapshot", {
      ...snapshotPayload,
      projectiles: [{
        id: "PABC234", owner: `net-${hostId}`, x: 430, y: 372, vx: 430,
        life: 1.15, radius: 12, colour: "#62c7ff", move: "guitar-special", hits: [],
      }],
    }));
    expect((await guest.next("arena-snapshot")).payload).toMatchObject({
      matchId: "NBATTLE23",
      seq: 1,
      time: 179.4,
      projectiles: [{ move: "guitar-special" }],
    });

    host.socket.send(clientPacket(room, hostId, "match-end", {
      matchId: "NBATTLE23",
      winner: hostId,
      reason: "last-note",
      fighters: [
        { id: hostId, stocks: 2, damage: 88, knockouts: 1 },
        { id: guestId, stocks: 0, damage: 152, knockouts: 0 },
      ],
    }));
    expect((await guest.next("match-end")).payload).toMatchObject({
      matchId: "NBATTLE23",
      winner: hostId,
      reason: "last-note",
    });

    host.socket.send(clientPacket(room, hostId, "rematch", {
      ...startPayload,
      matchId: "NENCORE23",
      startAt: Date.now() + 1450,
    }));
    expect((await host.next("rematch")).payload).toMatchObject({
      matchId: "NENCORE23",
    });
    expect((await guest.next("rematch")).payload).toMatchObject({
      matchId: "NENCORE23",
      players: roster,
    });
  });

  it("turns an explicit active-match leave into a permanent forfeit", async () => {
    const room = "LEFT23";
    const hostId = "PLAYER000051";
    const guestId = "PLAYER000052";
    const host = await connect(room, "create", hostId);
    await host.next("welcome");
    await host.next("room-welcome");
    const guest = await connect(room, "join", guestId);
    await guest.next("welcome");
    await guest.next("room-welcome");
    await host.next("room-join");
    host.socket.send(clientPacket(room, hostId, "player-ready", { ready: true, instrument: "guitar" }));
    await guest.next("player-ready");
    guest.socket.send(clientPacket(room, guestId, "player-ready", { ready: true, instrument: "bass" }));
    await host.next("player-ready");
    const startPayload = {
      matchId: "NLEAVE23",
      mode: "stock",
      stage: "mossvale-amphitheatre",
      stocks: 3,
      duration: 180,
      startAt: Date.now() + 1450,
      players: [
        { id: hostId, name: "Host", instrument: "guitar", colour: "#7df7a1" },
        { id: guestId, name: "Guest", instrument: "bass", colour: "#ff9d57" },
      ],
    };
    host.socket.send(clientPacket(room, hostId, "match-start", startPayload));
    await host.next("match-start");
    await guest.next("match-start");

    guest.socket.send(clientPacket(room, guestId, "room-leave", {}));
    expect((await host.next("room-leave")).payload).toMatchObject({
      temporary: false,
      reason: "forfeit",
      matchId: "NLEAVE23",
    });
  });
});

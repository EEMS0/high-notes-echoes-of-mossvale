import type { RelayEnv } from "./config";
import { readConfig } from "./config";
import {
  createRoomCode,
  healthPayload,
  parseRelayRoute,
} from "./Matchmaker";
import { NETWORK_PROTOCOL_VERSION } from "./protocol";
import { allowedCorsOrigin, originAllowed, secureTransportAllowed } from "./security";

export { GameRoom } from "./GameRoom";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(payload: Record<string, unknown>, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
  }
  return Response.json(payload, { status, headers });
}

function healthCorsHeaders(request: Request, config: ReturnType<typeof readConfig>): HeadersInit | undefined {
  const origin = allowedCorsOrigin(request, config);
  if (!origin) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

function isWebSocketRequest(request: Request): boolean {
  return request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);
    const config = readConfig(env);

    if (url.pathname === "/health" && request.method === "OPTIONS") {
      const cors = healthCorsHeaders(request, config);
      if (!cors) return json({ ok: false, error: "origin_rejected" }, 403);
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json(healthPayload(config), 200, healthCorsHeaders(request, config));
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "HIGH NOTES V2 relay",
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        health: "/health",
        allocateRoom: "POST /v2/rooms",
        connect: "/v2/rooms/{ROOM}?intent=create|join|reconnect&playerId={PLAYER_ID}",
        publicMatchmaking: false,
      });
    }
    if (request.method === "POST" && url.pathname === "/v2/rooms") {
      if (!originAllowed(request, config)) return json({ ok: false, error: "origin_rejected" }, 403);
      const roomCode = createRoomCode();
      return json({
        ok: true,
        protocolVersion: NETWORK_PROTOCOL_VERSION,
        roomCode,
        connectPath: `/v2/rooms/${roomCode}`,
      }, 201);
    }
    if (!isWebSocketRequest(request)) {
      return json({ ok: false, error: "not_found" }, 404);
    }
    if (!secureTransportAllowed(url, config)) {
      return json({ ok: false, error: "secure_transport_required" }, 426);
    }
    if (!originAllowed(request, config)) {
      return json({ ok: false, error: "origin_rejected" }, 403);
    }
    const route = parseRelayRoute(url);
    if (!route) return json({ ok: false, error: "invalid_room_route" }, 400);

    const roomId = env.GAME_ROOMS.idFromName(route.roomCode);
    const room = env.GAME_ROOMS.get(roomId);
    const internalHeaders = new Headers(request.headers);
    internalHeaders.set("X-HN-Room", route.roomCode);
    internalHeaders.set("X-HN-Intent", route.intent);
    if (route.playerId) internalHeaders.set("X-HN-Player", route.playerId);
    else internalHeaders.delete("X-HN-Player");
    if (route.reconnectToken) internalHeaders.set("X-HN-Token", route.reconnectToken);
    else internalHeaders.delete("X-HN-Token");

    return room.fetch(new Request("https://room.internal/connect", {
      method: "GET",
      headers: internalHeaders,
    }));
  },
} satisfies ExportedHandler<RelayEnv>;

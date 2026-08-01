# HIGH NOTES V2 multiplayer relay

This directory is the deployable Cloudflare Workers service for private HIGH NOTES rooms. It is intentionally separate from the static browser game: GitHub Pages serves the client, while this Worker terminates secure WebSockets and routes each room code to one SQLite-backed Durable Object.

Public matchmaking is deliberately disabled. The relay supports private casual rooms and a host-authoritative simulation contract; it is not an authoritative ranked server and must not be used to award trusted currency, unlocks, ratings, or ranked results.

## Architecture

```text
GitHub Pages client
  -> WSS /v2/rooms/{CODE}
Cloudflare Worker (path, origin, transport and parameter validation)
  -> GAME_ROOMS.idFromName(CODE)
GameRoom Durable Object (one isolated object per code)
  -> hibernating WebSockets
  -> SQLite-backed Durable Object storage
```

`src/index.ts` is the public HTTP boundary. `src/GameRoom.ts` owns membership and lobby state. `src/Matchmaker.ts` parses routes and generates private codes; it does not expose public discovery. `src/security.ts` centralises exact-origin, secure-transport, and health-CORS policy. `src/protocol.ts`, `src/validation.ts`, and `src/rateLimit.ts` define the versioned wire contract and abuse limits.

Room storage contains the host, capacity, players, ready/character/instrument/team choices, stage vote, casual match phase, timer origin, scores, respawn counts, and reconnect-token hashes. Raw reconnect tokens are returned only to their client and are never stored. WebSocket attachments preserve identity and rate-limit state while an object hibernates.

## Requirements

- Node.js 22 or newer
- npm (the repository uses the included `package-lock.json`)
- A Cloudflare account with Workers and Durable Objects access
- Wrangler authentication for deployment only

Do not add an API token, account ID, or reconnect token to source control.

## Install and validate

```bash
cd multiplayer-relay
npm ci
npm run check
```

`npm run check` runs strict TypeScript, Workers/Vitest tests, and a Wrangler dry-run bundle. Individual commands are:

```bash
npm run typecheck
npm test
npm run deploy:dry
```

The test suite exercises protocol aliases and malformed packets, the shipped Stock-mode packet shapes, numeric/state bounds, aggregate and per-message rate limits, route/origin validation, browser-readable health CORS, live Durable Object room creation/joining, room capacity, identity spoof rejection, reconnect tokens, host migration, no mid-match joins, and host-only authoritative snapshots.

## Local development

Start the local Workers runtime:

```bash
npm run dev
```

Wrangler normally listens on `http://localhost:8787`. Use `ws://localhost:8787` only for local development. The checked-in origin allowlist permits `http://localhost:8000`, `http://127.0.0.1:8000`, and the Wrangler port. If the client runs on another origin, update `ALLOWED_ORIGINS` locally rather than setting it to `*` in production.

Health check:

```bash
curl http://localhost:8787/health
```

The health response is deliberately non-sensitive and includes a numeric `timestamp`, protocol version, casual authority model, client input/snapshot rates, room capacity, reconnect window, and the fact that public matchmaking is disabled. It never includes room membership, room codes, reconnect tokens, credentials, or stored match state. Browser requests from an exact configured origin receive a matching `Access-Control-Allow-Origin`; unlisted origins are not granted CORS read access and no wildcard is emitted.

Example shape (values may vary by configuration):

```json
{
  "ok": true,
  "service": "high-notes-v2-relay",
  "protocolVersion": 2,
  "timestamp": 1785592800000,
  "publicMatchmaking": false,
  "authorityModel": "host-authoritative-casual",
  "networkTickRateHz": 20,
  "snapshotRateHz": 10,
  "maxRoomPlayers": 4,
  "reconnectWindowMs": 30000
}
```

Allocate a readable room code:

```bash
curl -X POST -H "Origin: http://localhost:8000" http://localhost:8787/v2/rooms
```

## Connection contract

The recommended client flow supplies the room and identity in the WebSocket URL so the Worker can route directly to the correct Durable Object:

```text
Create:    wss://RELAY_HOST/v2/rooms/ABC234?intent=create&playerId=PLAYER000001
Join:      wss://RELAY_HOST/v2/rooms/ABC234?intent=join&playerId=PLAYER000002
Reconnect: wss://RELAY_HOST/v2/rooms/ABC234?intent=reconnect&playerId=PLAYER000001&token=TOKEN
```

Compatibility routes `/ws/ABC234` and `/ws?room=ABC234` are also accepted. A connection with the default `intent=connect` may claim its identity with `hello`, then send `room-create` or `room-join`. A bare socket at `/` cannot be routed and is intentionally rejected.

Player IDs are 12 uppercase letters or digits. Room codes use six characters from `A-H`, `J-N`, `P-Z`, and `2-9`; ambiguous `I`, `O`, `0`, and `1` are excluded. Create codes with `POST /v2/rooms` or the same alphabet in the client.

The first `welcome` packet contains `playerId`, `host`, room capacity, protocol version, and a reconnect token. Treat that token as a short-lived bearer credential: retain it in memory or `sessionStorage`, never put it in chat/analytics/logs, and replace it whenever a successful reconnect rotates it. Disconnected membership is reserved for 30 seconds by default. After that grace period the token expires and the room slot is released.

### Envelope

Every client packet is UTF-8 JSON with this shape:

```json
{
  "v": 2,
  "type": "chat",
  "from": "PLAYER000001",
  "room": "ABC234",
  "payload": { "text": "Encore!" },
  "ts": 1785592800000,
  "seq": 42
}
```

`seq` is optional for the shipped client and recommended for input/state traffic. Duplicate or older sequence values for the same message type are ignored. The relay binds `from` to the socket identity, rejects room mismatches, validates and sanitises every payload, and then forwards the original hyphenated or underscore `type` unchanged. This lets upgraded and compatibility clients share a room.

### Message names

Protocol version: `NETWORK_PROTOCOL_VERSION = 2`.

The shipped hyphenated names are first-class: `hello`, `room-create`, `room-join`, `room-leave`, `room-sync`, `room-advertise`, `room-welcome`, `room-reject`, `profile`, `player-ready`, `select-character`, `select-instrument`, `select-stage`, `select-team`, `match-start`, `input`, `arena-input`, `snapshot`, `arena-state`, `arena-snapshot`, `state-snapshot`, `state-correction`, `attack`, `arena-hit`, `block`, `dodge`, `jump`, `ability`, `damage`, `knockback`, `knockout`, `respawn`, `score-update`, `match-end`, `rematch`, `world-ping`, `ping`, `pong`, `chat`, `emote`, and `reconnect`.

V2 underscore aliases are accepted and normalised internally:

| Underscore name | Internal compatibility name |
| --- | --- |
| `create_room`, `room_create` | `room-create` |
| `join_room`, `room_join`, `player_joined` | `room-join` |
| `leave_room`, `room_leave`, `player_left` | `room-leave` |
| `player_ready` | `player-ready` |
| `select_character`, `select_instrument`, `select_stage`, `select_team` | matching `select-*` name |
| `match_start`, `match_end` | matching `match-*` name |
| `arena_input`, `arena_state`, `arena_snapshot`, `arena_hit` | matching `arena-*` name |
| `state_snapshot`, `state_correction`, `score_update`, `world_ping` | matching hyphenated name |

Server-originated messages include `welcome`, `room-welcome`, `room-reject`, `room-join`, `room-leave`, `host-migrate`, and `error`. A connected member can send the empty `room-sync` control packet to request a fresh authoritative `room-welcome` after scripts load or a page reconnects. Errors include a machine-readable `code`, a safe message, and optional `retryAfterMs`/`fatal` fields.

### Shipped platform-fighter contract

The relay validates the exact payloads emitted by `v2-platform-fighter.js` and reconstructs a bounded object before forwarding it:

| Packet | Sender / route | Bounded content |
| --- | --- | --- |
| `match-start`, `rematch` | Host to room | Match ID, `stock`, `mossvale-amphitheatre`, 1-5 stocks, 30-600 seconds, near-future start time, and an exact 2-4 player roster with selected instruments |
| `arena-input` | Non-host fighter to host only | Match/packet sequence, normalised X/Y axes, guard flag, and at most one allowlisted action with bounded axes/timestamp |
| `arena-snapshot` | Host to non-host clients | Match sequence/time/phase, exact active roster, bounded position/velocity/damage/stock/guard/disconnect state, and at most 24 bounded projectiles with their move identity so authority migration can resume them safely |
| `match-end` | Host to room | Active match ID, optional active-roster winner/abandonment, safe reason, and exact bounded result rows when supplied |

Unknown payload fields are dropped. Fighter IDs must belong to the active match. Projectile owners must resolve to an active fighter (the shipped `net-PLAYERID` form is supported). Snapshot stocks cannot exceed the match rules, and a room cannot gain a new fighter while a match is in progress. The relay forwards real-time input/snapshots without Durable Object writes; only room/lobby/match metadata is persisted.

### Authority rules

- The server owns identity, membership, capacity, reconnect reservations, and host transfer.
- Players may only change their own ready/loadout/team/vote fields.
- Only the current host can start/end matches or send authoritative snapshots, corrections, damage, knockback, knockouts, respawns, and score updates.
- The current playable relay ruleset is Stock on Mossvale Amphitheatre. Foundation-only modes/stages are rejected instead of being presented as working multiplayer content.
- A match start/rematch must contain every connected ready member once, and each instrument must match that player's server-held ready selection.
- During a match, non-host arena input is routed only to the host; host input relay packets and non-host snapshots are rejected.
- Snapshot and result rosters must exactly match the active match. New identities cannot join mid-match, while token-authenticated members can reconnect.
- `arena-hit` remains available for the existing casual client, with target, damage, size, membership, and frequency validation. It is not trusted for competitive rewards.
- Public lobby discovery and ranked result submission are not implemented.

## Limits and environment configuration

Values live in `wrangler.jsonc` and are read once per Durable Object activation:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `ENVIRONMENT` | `production` | Requires secure non-local transport |
| `ALLOWED_ORIGINS` | GitHub Pages + local origins | Comma-separated exact browser origins |
| `REQUIRE_ORIGIN` | `true` | Reject missing Origin headers on room allocation/WebSockets |
| `MAX_ROOM_PLAYERS` | `4` | Hard room capacity (bounded to 2–4) |
| `MAX_MESSAGE_BYTES` | `16384` | Maximum UTF-8 WebSocket frame size |
| `MAX_MESSAGES_PER_SECOND` | `45` | Aggregate per-socket message ceiling |
| `MAX_BYTES_PER_SECOND` | `98304` | Aggregate per-socket bandwidth ceiling |
| `RECONNECT_GRACE_SECONDS` | `30` | Disconnected identity reservation |
| `ROOM_IDLE_TTL_SECONDS` | `300` | Empty-room storage cleanup delay |

Chat, emotes, pings, inputs, authoritative arena snapshots, and combat events also have narrower type-specific windows. The shipped client sends input at 20 Hz and authoritative snapshots at approximately 10 Hz; the relay ceilings leave bounded jitter headroom without permitting unbounded floods. Five repeated violations close the socket. Binary frames, unknown envelope fields, incompatible versions, invalid numeric ranges, oversized strings, HTML control characters, duplicate identities, and spoofed targets are rejected.

## Cloudflare configuration and deployment

`wrangler.jsonc` binds `GAME_ROOMS` to `GameRoom` and creates it as a SQLite-backed Durable Object in migration `v1`. Do not change or remove an already-deployed migration tag. Add a new migration tag for future class lifecycle changes.

Authenticate interactively as the repository owner:

```bash
npx wrangler login
npx wrangler whoami
```

Validate and deploy:

```bash
npm run check
npm run deploy
```

Wrangler prints an HTTPS Worker URL such as:

```text
https://high-notes-v2-relay.YOUR-SUBDOMAIN.workers.dev
```

Use the same host with the `wss` scheme in the game:

```text
wss://high-notes-v2-relay.YOUR-SUBDOMAIN.workers.dev
```

The client must append `/v2/rooms/{CODE}` and the connection parameters described above. Do not point the current client at only the bare hostname unless its relay adapter performs that expansion.

After the first deployment:

1. Confirm `https://WORKER_HOST/health` reports protocol `2`.
   From the GitHub Pages origin, confirm the response is CORS-readable and its numeric `timestamp` is current.
2. Add the production WSS base URL to the game’s non-secret relay configuration.
3. Test create/join/reconnect in two independent browsers.
4. Keep public matchmaking disabled.
5. Add any custom production game origin to `ALLOWED_ORIGINS`, run `npm run check`, and redeploy.

## Hibernation, cleanup, and free-tier use

The service uses `ctx.acceptWebSocket`, serialised socket attachments, and event handlers instead of timers, so idle rooms can hibernate without disconnecting clients. Room state is small and only lobby/match metadata is persisted; 10–20 Hz input and snapshots are forwarded, not written to storage. Empty room records are removed by Durable Object alarms.

Cloudflare plan quotas and Durable Object billing can change. Before a public launch, check the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), and [pricing](https://developers.cloudflare.com/workers/platform/pricing/). The configured four-player private rooms are intentionally conservative, but a free allocation is not an unlimited multiplayer service.

## Security limitations

This relay provides transport, validation, room isolation, and host authority—not deterministic server-side combat simulation. A malicious host can still lie about casual match state. Accordingly:

- Never use relay packets as proof of currency, inventory, unlocks, achievements, rating, or ranked wins.
- Keep PvP casual and rewards cosmetic/non-authoritative until a server simulation validates movement, cooldowns, hitboxes, and results.
- Reconnect tokens are bearer credentials and are rotated after use, but there is no account authentication.
- Chat is length-limited and markup/control characters are removed; the client must still render it as text or escape HTML.
- Origin checks reduce browser abuse but are not authentication and can be forged by non-browser clients.
- TLS is provided by Cloudflare in production. Direct insecure non-local WebSocket URLs are rejected.

## Troubleshooting

- **`origin_rejected`**: add the exact game origin (scheme + host, no path) to `ALLOWED_ORIGINS` and redeploy.
- **`invalid_room_route`**: use a six-character room code and a routed WebSocket path, not the Worker root.
- **`protocol_mismatch`**: deploy a client that sends `v: 2`; the server closes incompatible sockets clearly.
- **`room_not_found`**: the host must create the room before guests join it.
- **`identity_reserved`**: the ID is in use or awaiting reconnect; provide its latest token or use another ID.
- **`reconnect_expired`**: the grace window ended; join as a new identity.
- **`rate_limited`**: reduce update frequency or packet size; do not reconnect-loop around limits.
- **Local socket rejected**: use an allowed local Origin and `ws://localhost:8787`, or set `ENVIRONMENT=development` in an uncommitted local override.
- **Wrangler migration error**: do not replace `new_sqlite_classes` with legacy `new_classes`; new Durable Object namespaces require SQLite storage.

## Production deployment

The relay is deployed at `https://high-notes-v2-relay.jl-bmfx.workers.dev` and the game defaults to `wss://high-notes-v2-relay.jl-bmfx.workers.dev`. The health endpoint, room allocation, create/join flow, authoritative match start, reconnect-token rotation, active-match refresh hydration, and explicit-leave forfeit flow have been exercised against the public Worker with two browser clients. Re-run `npm run deploy` only after the relay source, bindings, or production configuration changes.

For final public-internet acceptance, use the same room code from two genuinely separate networks (for example desktop broadband and a phone on mobile data), complete a Stock match, verify movement/attacks/damage/knockback/KO/respawn/result agreement, then exercise refresh, temporary network loss, host departure, and mobile background/restore. Record only devices, browsers, networks, latency, reconnect behaviour, and desynchronisation that were actually observed; local multi-tab tests are not cross-network proof.

import { describe, expect, it } from "vitest";
import { consumeRateLimit, createRateState, registerRateStrike } from "../src/rateLimit";

describe("connection rate limits", () => {
  const config = { maxMessagesPerSecond: 45, maxBytesPerSecond: 98_304 };

  it("allows the intended 30 Hz input budget", () => {
    const state = createRateState(1000);
    for (let index = 0; index < 30; index += 1) {
      expect(consumeRateLimit(state, 1000 + index * 30, 80, "input", config).allowed).toBe(true);
    }
  });

  it("throttles chat independently of movement", () => {
    const state = createRateState(1000);
    for (let index = 0; index < 4; index += 1) {
      expect(consumeRateLimit(state, 1000 + index, 80, "chat", config).allowed).toBe(true);
    }
    expect(consumeRateLimit(state, 1005, 80, "chat", config)).toMatchObject({
      allowed: false,
      reason: "type_rate",
    });
  });

  it("limits aggregate messages and bandwidth", () => {
    const messageState = createRateState(1000);
    for (let index = 0; index < 45; index += 1) {
      expect(consumeRateLimit(messageState, 1000, 10, "profile", config).allowed).toBe(true);
    }
    expect(consumeRateLimit(messageState, 1000, 10, "profile", config).reason).toBe("message_rate");

    const byteState = createRateState(1000);
    expect(consumeRateLimit(byteState, 1000, 98_304, "profile", config).allowed).toBe(true);
    expect(consumeRateLimit(byteState, 1000, 1, "profile", config).reason).toBe("bandwidth");
  });

  it("decays violation strikes after a quiet interval", () => {
    const state = createRateState(0);
    expect(registerRateStrike(state, 1000)).toBe(1);
    consumeRateLimit(state, 32_000, 10, "profile", config);
    expect(state.strikes).toBe(0);
  });
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/protocol.test.ts"],
    testTimeout: 10_000,
  },
});

import { describe, expect, it } from "vitest";

import { checkRateLimit } from "../lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows a bounded burst and resets after the window", () => {
    const clientId = `test-${Math.random()}`;

    for (let index = 0; index < 10; index += 1) {
      expect(checkRateLimit(clientId, 1_000).allowed).toBe(true);
    }

    expect(checkRateLimit(clientId, 1_000).allowed).toBe(false);
    expect(checkRateLimit(clientId, 62_000).allowed).toBe(true);
  });
});

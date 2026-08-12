const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 10;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  agentEvalRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits =
  globalStore.agentEvalRateLimits ?? new Map<string, RateLimitEntry>();

globalStore.agentEvalRateLimits = rateLimits;

export function checkRateLimit(identifier: string, now = Date.now()) {
  if (rateLimits.size > 1_000) {
    for (const [key, entry] of rateLimits) {
      if (entry.resetAt <= now) {
        rateLimits.delete(key);
      }
    }
  }

  const current = rateLimits.get(identifier);

  if (!current || current.resetAt <= now) {
    rateLimits.set(identifier, {
      count: 1,
      resetAt: now + WINDOW_MS
    });

    return {
      allowed: true,
      remaining: REQUEST_LIMIT - 1,
      retryAfterSeconds: 0
    };
  }

  if (current.count >= REQUEST_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;

  return {
    allowed: true,
    remaining: REQUEST_LIMIT - current.count,
    retryAfterSeconds: 0
  };
}

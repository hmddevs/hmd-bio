import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callerBucketKeys,
  rateLimitCaller,
  type RateLimitedCaller,
} from "@/lib/rate-limit";
import { SESSION_ACCESS, resolveKeyAccess } from "@/lib/api-key-scope";

// No Upstash credentials in the test environment, so `rateLimit` falls through
// to its in-memory limiter. That is exactly what we want here: the counting is
// real and deterministic, so these are behavioural tests of the nesting rather
// than assertions about a mock. `captureError` is silenced because the fallback
// reports itself to Sentry on every call.
vi.mock("@/lib/errors", () => ({ captureError: () => {} }));

const USER_ID = "507f1f77bcf86cd799439011";

function sessionCaller(userId = USER_ID): RateLimitedCaller {
  return { user: { id: userId }, access: SESSION_ACCESS };
}

function keyCaller(keyId: string, userId = USER_ID): RateLimitedCaller {
  const resolved = resolveKeyAccess({ keyId });
  if (!resolved.ok) throw new Error("expected the key to resolve");
  return { user: { id: userId }, access: resolved.access };
}

/** Drive one caller until it is refused, returning how many were allowed. */
async function drain(scope: string, caller: RateLimitedCaller, attempts: number) {
  let allowed = 0;
  for (let i = 0; i < attempts; i++) {
    const result = await rateLimitCaller(scope, caller);
    if (result.allowed) allowed++;
  }
  return allowed;
}

// Each test uses its own scope string so the in-memory buckets, which persist
// across tests in one process, cannot leak between them.
let counter = 0;
let scope = "";
beforeEach(() => {
  counter += 1;
  scope = `test-scope-${counter}`;
});

describe("bucket key derivation", () => {
  it("keys the outer bucket exactly as the routes used to build it by hand", () => {
    // The format must not change, or every live bucket resets on deploy.
    expect(callerBucketKeys("links-list", sessionCaller())).toEqual({
      outer: `links-list:${USER_ID}`,
      inner: null,
    });
  });

  it("gives a session no inner bucket", () => {
    expect(callerBucketKeys("links-list", sessionCaller()).inner).toBeNull();
  });

  it("gives a key its own inner bucket beneath the account ceiling", () => {
    const keys = callerBucketKeys("links-list", keyCaller("key-a"));

    expect(keys.outer).toBe(`links-list:${USER_ID}`);
    expect(keys.inner).toBe(`links-list:${USER_ID}:key:key-a`);
  });

  it("puts a session and a key on the same account in different inner buckets", () => {
    const viaSession = callerBucketKeys("links-list", sessionCaller());
    const viaKey = callerBucketKeys("links-list", keyCaller("key-a"));

    expect(viaSession.outer).toBe(viaKey.outer); // same account ceiling
    expect(viaSession.inner).not.toBe(viaKey.inner);
  });

  it("puts two keys on one account in different inner buckets", () => {
    const a = callerBucketKeys("links-list", keyCaller("key-a"));
    const b = callerBucketKeys("links-list", keyCaller("key-b"));

    expect(a.outer).toBe(b.outer);
    expect(a.inner).not.toBe(b.inner);
  });

  it("namespaces the inner bucket so it cannot collide with an outer one", () => {
    // Without the "key:" segment, a key whose id happened to equal a user id
    // would share that user's account ceiling as its inner bucket.
    const collidingKey = callerBucketKeys("links-list", keyCaller(USER_ID));

    expect(collidingKey.inner).toBe(`links-list:${USER_ID}:key:${USER_ID}`);
    expect(collidingKey.inner).not.toBe(collidingKey.outer);
  });

  it("separates the same key across different route scopes", () => {
    expect(callerBucketKeys("links-list", keyCaller("key-a")).inner).not.toBe(
      callerBucketKeys("links-keyword", keyCaller("key-a")).inner
    );
  });

  it("falls back to no inner bucket when a key carries no id", () => {
    // Sharing one inner bucket between every id-less key would be worse than
    // having none, since unrelated keys would throttle each other.
    const resolved = resolveKeyAccess({});
    if (!resolved.ok) throw new Error("expected the key to resolve");

    expect(
      callerBucketKeys("links-list", { user: { id: USER_ID }, access: resolved.access }).inner
    ).toBeNull();
  });
});

describe("nesting behaviour", () => {
  it("lets a session use the whole account ceiling, as it did before", async () => {
    expect(await drain(scope, sessionCaller(), 120)).toBe(100);
  });

  it("caps one key below the account ceiling so the owner keeps headroom", async () => {
    // The point of the inner bucket: a single key cannot take all 100.
    expect(await drain(scope, keyCaller("key-a"), 120)).toBe(50);
  });

  it("leaves the dashboard usable after a key has exhausted its own bucket", async () => {
    expect(await drain(scope, keyCaller("key-a"), 120)).toBe(50);

    // The key consumed 50 of the account's 100, so the session still has 50.
    const result = await rateLimitCaller(scope, sessionCaller());
    expect(result.allowed).toBe(true);
  });

  it("does not let one key starve a sibling key", async () => {
    expect(await drain(scope, keyCaller("key-a"), 80)).toBe(50);

    const sibling = await rateLimitCaller(scope, keyCaller("key-b"));
    expect(sibling.allowed).toBe(true);
  });

  it("still bounds the account total when several keys are active at once", async () => {
    // Three keys, each willing to take 50, against an account ceiling of 100.
    // The outer bucket must hold the total at 100 rather than 150.
    const total =
      (await drain(scope, keyCaller("key-a"), 60)) +
      (await drain(scope, keyCaller("key-b"), 60)) +
      (await drain(scope, keyCaller("key-c"), 60));

    expect(total).toBe(100);
  });

  it("keeps separate accounts independent", async () => {
    expect(await drain(scope, keyCaller("key-a", "user-one"), 120)).toBe(50);

    const other = await rateLimitCaller(scope, keyCaller("key-a", "user-two"));
    expect(other.allowed).toBe(true);
  });

  it("reports the inner limit when the inner bucket is what refused", async () => {
    await drain(scope, keyCaller("key-a"), 50);

    const refused = await rateLimitCaller(scope, keyCaller("key-a"));
    expect(refused.allowed).toBe(false);
    // The caller should see the limit that actually applies to it, 50, not the
    // account's 100.
    expect(refused.limit).toBe(50);
  });

  it("honours an explicit limit and window, dividing that rather than the tier", async () => {
    // The domain-verify route uses 6 an hour rather than a tier.
    const options = { limit: 6, windowMs: 3_600_000 };
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const result = await rateLimitCaller(scope, keyCaller("key-a"), options);
      if (result.allowed) allowed++;
    }

    expect(allowed).toBe(3);
  });

  it("never divides an explicit limit down to zero", async () => {
    // A limit of 1 must still permit one request, not floor to nothing.
    const result = await rateLimitCaller(scope, keyCaller("key-a"), {
      limit: 1,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(true);
  });
});

describe("a legacy key with none of the new fields", () => {
  it("resolves and is rate limited without error", async () => {
    // A pre-scoping key has no scope, domains or expiry. It does have an `_id`,
    // so it gets an inner bucket like any other key.
    const resolved = resolveKeyAccess({ keyId: "legacy-key-id" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const caller: RateLimitedCaller = {
      user: { id: USER_ID },
      access: resolved.access,
    };

    expect(callerBucketKeys(scope, caller).inner).toBe(
      `${scope}:${USER_ID}:key:legacy-key-id`
    );
    expect(await drain(scope, caller, 120)).toBe(50);
  });

  it("shares the account ceiling with the owner's session, as it always did", async () => {
    const legacy = keyCaller("legacy-key-id");

    await drain(scope, legacy, 60);
    // 50 consumed by the key leaves 50 on the account.
    expect(await drain(scope, sessionCaller(), 80)).toBe(50);
  });
});

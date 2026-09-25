import assert from "node:assert/strict";
import test from "node:test";

import { abandonStripeCheckoutSession } from "../../src/server/storefront/checkoutAbandonService.ts";
import { StorefrontApiError } from "../../src/server/storefront/storefrontApiError.ts";

const credential = { intentId: 41, rawToken: "A".repeat(43) };
const request = {};
const session = (status) => ({
  expiresAt: "2026-09-26T20:00:00.000Z",
  expiresAtEpochSeconds: 1_790_451_200,
  id: "cs_test_synthetic",
  status,
  url: status === "open" ? "https://checkout.stripe.com/c/pay/cs_test_synthetic" : null,
});

const dependenciesFor = ({
  finalize = async () => {},
  resolved = session("open"),
  expire = async () => session("expired"),
} = {}) => {
  const sequence = [];
  const dependencies = {
    authorizeIntent: async () => {
      sequence.push("authorize");
      return { status: "checkout_created" };
    },
    finalizeExpiredIntent: async (options) => {
      sequence.push("finalize");
      assert.equal(options.credential, credential);
      assert.equal(options.sessionId, "cs_test_synthetic");
      await finalize(options);
    },
    gateway: {
      createSession: async () => assert.fail("create is owned by the resolver"),
      expireSession: async (id) => {
        sequence.push("expire");
        assert.equal(id, "cs_test_synthetic");
        return expire();
      },
      retrieveSession: async () => assert.fail("retrieve is owned by the resolver"),
    },
    resolveSession: async (options) => {
      sequence.push("resolve");
      assert.equal(options.credential, credential);
      assert.equal(options.request, request);
      return { created: false, session: resolved };
    },
  };
  return { dependencies, sequence };
};

test("an open Session is expired before local finalization", async () => {
  const fixture = dependenciesFor();
  await abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request });
  assert.deepEqual(fixture.sequence, ["authorize", "resolve", "expire", "finalize"]);
});

test("an already-expired Session safely reconciles without another expiration", async () => {
  const fixture = dependenciesFor({ resolved: session("expired") });
  await abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request });
  assert.deepEqual(fixture.sequence, ["authorize", "resolve", "finalize"]);
});

test("complete or paid processing cannot be abandoned", async () => {
  const fixture = dependenciesFor({ resolved: session("complete") });
  await assert.rejects(
    () => abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request }),
    (error) => error instanceof StorefrontApiError && error.status === 409,
  );
  assert.deepEqual(fixture.sequence, ["authorize", "resolve"]);
});

test("Stripe ambiguity preserves local state and remains retryable", async () => {
  const fixture = dependenciesFor({ expire: async () => { throw new Error("private Stripe detail"); } });
  await assert.rejects(
    () => abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request }),
    (error) => error instanceof StorefrontApiError && error.status === 503,
  );
  assert.deepEqual(fixture.sequence, ["authorize", "resolve", "expire"]);
});

test("a retry reconciles Stripe expiration after local finalization failure", async () => {
  let finalizations = 0;
  const first = dependenciesFor({
    finalize: async () => {
      finalizations += 1;
      throw new StorefrontApiError(500, "CHECKOUT_ABANDON_FINALIZATION_FAILED");
    },
  });
  await assert.rejects(() => abandonStripeCheckoutSession({
    credential,
    dependencies: first.dependencies,
    request,
  }));
  assert.deepEqual(first.sequence, ["authorize", "resolve", "expire", "finalize"]);

  const retry = dependenciesFor({
    finalize: async () => { finalizations += 1; },
    resolved: session("expired"),
  });
  await abandonStripeCheckoutSession({ credential, dependencies: retry.dependencies, request });
  assert.deepEqual(retry.sequence, ["authorize", "resolve", "finalize"]);
  assert.equal(finalizations, 2);
});

test("webhook completion wins the row-lock race", async () => {
  const fixture = dependenciesFor({
    finalize: async () => {
      throw new StorefrontApiError(409, "CHECKOUT_PROCESSING");
    },
  });
  await assert.rejects(
    () => abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request }),
    (error) => error instanceof StorefrontApiError && error.status === 409,
  );
  assert.deepEqual(fixture.sequence, ["authorize", "resolve", "expire", "finalize"]);
});

test("a draft Intent cannot be abandoned or cause Stripe mutation", async () => {
  const fixture = dependenciesFor();
  fixture.dependencies.authorizeIntent = async () => {
    fixture.sequence.push("authorize");
    return { status: "draft" };
  };
  await assert.rejects(
    () => abandonStripeCheckoutSession({ credential, dependencies: fixture.dependencies, request }),
    (error) => error instanceof StorefrontApiError && error.status === 409,
  );
  assert.deepEqual(fixture.sequence, ["authorize"]);
});

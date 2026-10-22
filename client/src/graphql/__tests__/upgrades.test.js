// Regression tests for the upgrade outcome watcher (graphql/upgrades.js).
// The mocked client exposes ONLY the real urql API surface (query/mutation/
// subscription) — a repeat of the `graphqlClient.subscribe(...)` typo would
// throw TypeError here instead of silently breaking prod upgrades.
import { describe, it, expect, vi, afterEach } from "vitest";
import { upgradeRunnerContainer } from "../upgrades";

const handlers = { mutation: null, query: null, subscription: null };
const calls = { subscription: 0 };

vi.mock("../client", () => ({
  graphqlClient: {
    query: (doc, vars) => handlers.query(doc, vars),
    mutation: (doc, vars) => handlers.mutation(doc, vars),
    subscription: (doc, opts) => {
      calls.subscription++;
      return handlers.subscription(doc, opts);
    },
  },
}));

const source = { id: "abc123def456", image: "img:1", name: "famOS", runnerId: 16 };

const opResult = (payload) => ({ toPromise: () => Promise.resolve(payload) });

afterEach(() => {
  handlers.mutation = handlers.query = handlers.subscription = null;
  calls.subscription = 0;
});

function okMutation() {
  handlers.mutation = () => opResult({ data: { upgradeContainer: { id: "op-1" } } });
}

describe("upgradeRunnerContainer", () => {
  it("resolves when the subscription reports COMPLETED for our operation", async () => {
    okMutation();
    handlers.subscription = () => ({
      subscribe: (cb) => {
        cb({ data: { containerUpgradeProgress: { operationId: "op-1", phase: "COMPLETED" } } });
        return { unsubscribe: () => {} };
      },
    });
    const res = await upgradeRunnerContainer(source);
    expect(res).toEqual({ success: true, operationId: "op-1" });
    expect(calls.subscription).toBe(1);
  });

  it("rejects with the event message when the subscription reports FAILED", async () => {
    okMutation();
    handlers.subscription = () => ({
      subscribe: (cb) => {
        cb({
          data: {
            containerUpgradeProgress: {
              operationId: "op-1",
              phase: "FAILED",
              message: "pull denied",
            },
          },
        });
        return { unsubscribe: () => {} };
      },
    });
    const err = await upgradeRunnerContainer(source).catch((e) => e);
    expect(err.message).toBe("pull denied");
    // Terminal FAILED is a definitive server verdict: it must be tagged so
    // the caller's network-recovery path can't turn it into a false success.
    expect(err.operationError).toBe(true);
  });

  it("tags server-side GraphQL rejections (blocklist, authz, limiter) as operationError", async () => {
    // urql surfaces GraphQL errors as a CombinedError with graphQLErrors —
    // the server RESPONDED, the upgrade never started.
    handlers.mutation = () =>
      opResult({
        error: {
          graphQLErrors: [{ message: "container is blocklisted" }],
          message: "container is blocklisted",
        },
      });
    await upgradeRunnerContainer(source).catch((e) => {
      expect(e.message).toBe("container is blocklisted");
      expect(e.operationError).toBe(true);
    });
  });

  it("does NOT tag transport failures (network recovery stays allowed)", async () => {
    handlers.mutation = () =>
      opResult({ error: { graphQLErrors: [], networkError: new Error("Failed to fetch") } });
    await upgradeRunnerContainer(source).catch((e) => {
      expect(e.operationError).toBeUndefined();
    });
  });

  it("ignores events for other operations and falls back to upgradeHistory polling", async () => {
    okMutation();
    handlers.subscription = () => ({
      subscribe: (cb) => {
        // wrong operationId must not settle the promise
        cb({ data: { containerUpgradeProgress: { operationId: "other", phase: "COMPLETED" } } });
        return { unsubscribe: () => {} };
      },
    });
    handlers.query = () =>
      opResult({
        data: {
          upgradeHistory: {
            items: [{ dockerContainerId: source.id, status: "SUCCESS" }],
          },
        },
      });
    const res = await upgradeRunnerContainer(source, { timeoutMs: 9000 });
    expect(res.success).toBe(true);
  }, 10000);
});

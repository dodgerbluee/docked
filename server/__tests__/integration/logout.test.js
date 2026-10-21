/**
 * Regression tests for token revocation at the Node edge.
 *
 * JWTs are stateless, so a revoked token must be rejected before its exp
 * claim. The logout endpoint itself now lives in the Go backend (and revokes
 * into the shared revoked_tokens table, covered by Go handler tests); what
 * stays under test here is Node's authenticate middleware consulting that
 * same shared table for every protected route it proxies.
 * Uses a dedicated DATA_DIR for isolation.
 */
process.env.DATA_DIR = `${require("os").tmpdir()}/docked-test-data-logout`;
// Pin the Go backend to a port nothing listens on: the debug mount is now a
// goRunnerProxy passthrough, so a valid token reaches the proxy and gets a
// deterministic 502 ("Go backend unavailable") instead of racing whatever
// happens to run on :4000 on the developer's machine.
process.env.GRAPHQL_BACKEND = "http://127.0.0.1:1";

const request = require("supertest");
const app = require("../../server");
const { getDatabase, waitForDatabaseInit } = require("../../db/connection");
const { createUser, getUserByUsername } = require("../../db/index");
const { generateToken, verifyToken } = require("../../utils/jwt");
const { revokeToken } = require("../../db/revokedTokens");

function deleteUser(username) {
  return new Promise((resolve, reject) => {
    getDatabase().run("DELETE FROM users WHERE username = ?", [username], (err) =>
      err ? reject(err) : resolve()
    );
  });
}

describe("revoked tokens are rejected by the authenticate middleware", () => {
  const username = "revoking-user";
  const password = "testpass-1234";
  let token;
  let userId;

  beforeAll(async () => {
    // On a fresh CI tmpdir the DB file has no tables yet; server.js defers
    // initializeDatabase via setImmediate, so wait for it before touching the DB.
    await waitForDatabaseInit();
    // The dedicated DATA_DIR's DB file persists across jest runs; clear the row
    // so re-runs start clean (createUser does a bare INSERT).
    await deleteUser(username);
    await createUser(username, password, null, "Administrator", true, false);
    const user = await getUserByUsername(username);
    userId = user.id;
    token = generateToken({ userId: user.id, username: user.username, role: user.role });
  });

  // /api/debug/health sits behind authenticate and is proxied to Go; a valid
  // token reaches the proxy (502 with the backend pinned to a dead port),
  // proving auth passed. A revoked/invalid token is rejected earlier (401).
  const probe = (bearer) =>
    request(app).get("/api/debug/health").set("Authorization", `Bearer ${bearer}`);

  it("authenticates a valid token", async () => {
    const res = await probe(token).expect(502); // 502 = reached the proxy, not auth
    expect(res.body.error).toMatch(/Go backend unavailable/);
  });

  it("rejects the revoked token on subsequent authenticated requests", async () => {
    const decoded = verifyToken(token);
    await revokeToken(token, userId, decoded.exp);

    const res = await probe(token).expect(401);
    expect(res.body.success).toBe(false);
  });

  it("still accepts a different token for the same user", async () => {
    const user = await getUserByUsername(username);
    // Different role payload => distinct token string (avoids same-second iat
    // collision producing an identical token that is already revoked).
    const fresh = generateToken({ userId: user.id, username: user.username, role: "Member" });
    const res = await probe(fresh).expect(502);
    expect(res.body.error).toMatch(/Go backend unavailable/);
  });
});

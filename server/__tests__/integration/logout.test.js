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

  // /api/debug/health sits behind authenticate; with debug endpoints off an
  // authenticated request reaches the gate (403), proving auth passed.
  const probe = (bearer) =>
    request(app).get("/api/debug/health").set("Authorization", `Bearer ${bearer}`);

  it("authenticates a valid token", async () => {
    const res = await probe(token).expect(403); // 403 = debug gate, not auth
    expect(res.body.error).toMatch(/Debug endpoints are disabled/);
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
    const res = await probe(fresh).expect(403);
    expect(res.body.error).toMatch(/Debug endpoints are disabled/);
  });
});

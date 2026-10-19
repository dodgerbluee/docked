/**
 * Regression tests for logout token revocation.
 *
 * JWTs are stateless, so logging out must record the presented token in the
 * shared revoked_tokens table; the auth middleware then rejects it before its
 * exp claim. This closes the replay window a leaked token would otherwise keep
 * until it naturally expires. Uses a dedicated DATA_DIR for isolation.
 */
process.env.DATA_DIR = `${require("os").tmpdir()}/docked-test-data-logout`;

const request = require("supertest");
const app = require("../../server");
const { getDatabase, waitForDatabaseInit } = require("../../db/connection");
const { createUser, getUserByUsername } = require("../../db/index");
const { generateToken } = require("../../utils/jwt");

function deleteUser(username) {
  return new Promise((resolve, reject) => {
    getDatabase().run("DELETE FROM users WHERE username = ?", [username], (err) =>
      err ? reject(err) : resolve()
    );
  });
}

describe("POST /api/auth/logout revocation", () => {
  const username = "revoking-user";
  const password = "testpass-1234";
  let token;

  beforeAll(async () => {
    // On a fresh CI tmpdir the DB file has no tables yet; server.js defers
    // initializeDatabase via setImmediate, so wait for it before touching the DB.
    await waitForDatabaseInit();
    // The dedicated DATA_DIR's DB file persists across jest runs; clear the row
    // so re-runs start clean (createUser does a bare INSERT, unlike the import
    // endpoint which tolerates an existing user).
    await deleteUser(username);
    await createUser(username, password, null, "Administrator", true, false);
    const user = await getUserByUsername(username);
    token = generateToken({ userId: user.id, username: user.username, role: user.role });
  });

  it("authenticates the token before logout", async () => {
    const res = await request(app)
      .get("/api/user/export-config")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toBeTruthy();
  });

  it("revokes the token on logout", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects the revoked token on subsequent authenticated requests", async () => {
    const res = await request(app)
      .get("/api/user/export-config")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it("still accepts a different token for the same user", async () => {
    const user = await getUserByUsername(username);
    // Different role payload => distinct token string (avoids same-second iat
    // collision producing an identical token that is already revoked).
    const fresh = generateToken({ userId: user.id, username: user.username, role: "Member" });
    const res = await request(app)
      .get("/api/user/export-config")
      .set("Authorization", `Bearer ${fresh}`)
      .expect(200);
    expect(res.body).toBeTruthy();
  });
});

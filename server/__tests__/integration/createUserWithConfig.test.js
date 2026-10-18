/**
 * Regression tests for the privilege-grant gate on
 * POST /api/auth/create-user-with-config.
 *
 * The route is public (bootstrap/import flow runs before anyone is logged
 * in), so instance-admin creation is only honored when the caller presents
 * the pending verification token that the graph minted via
 * generateInstanceAdminToken and the operator read out of the container
 * logs. The token is consumed atomically at grant time; before this gate
 * existed, an anonymous caller could self-grant instance admin with a bare
 * POST.
 */
const request = require("supertest");
const app = require("../../server");
const { getDatabase } = require("../../db/connection");
const { getUserByUsername } = require("../../db/index");

function setPendingToken(username, token) {
  return new Promise((resolve, reject) => {
    getDatabase().run(
      "INSERT OR REPLACE INTO pending_auth_tokens (kind, username, token, created_at) VALUES ('instance_admin', ?, ?, CURRENT_TIMESTAMP)",
      [username, token],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

describe("POST /api/auth/create-user-with-config privilege gate", () => {
  const password = "testpass-1234";

  beforeAll(async () => {
    // The shared test DB file persists across runs and may predate this
    // table; create it the same way db/connection.js does at startup.
    await new Promise((resolve, reject) => {
      getDatabase().run(
        `CREATE TABLE IF NOT EXISTS pending_auth_tokens (
          kind TEXT NOT NULL,
          username TEXT NOT NULL DEFAULT '',
          token TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (kind, username)
        )`,
        (err) => (err ? reject(err) : resolve())
      );
    });
  });

  it("rejects instance-admin creation with no verification token", async () => {
    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({ userData: { username: "natok-intruder", password, instanceAdmin: true } })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(await getUserByUsername("natok-intruder")).toBeNull();
  });

  it("rejects instance-admin creation with a wrong token", async () => {
    await setPendingToken("wrong-tok-intruder", "GOOD-TOKN-HERE");

    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({
        userData: { username: "wrong-tok-intruder", password, instanceAdmin: true },
        verificationToken: "BAD-TOKN-HERE",
      })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(await getUserByUsername("wrong-tok-intruder")).toBeNull();
  });

  it("creates the instance admin with a valid pending token and consumes it", async () => {
    await setPendingToken("legit-import-admin", "GOOD-TOKN-HERE");

    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({
        userData: { username: "legit-import-admin", password, instanceAdmin: true },
        verificationToken: "GOOD-TOKN-HERE",
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    const user = await getUserByUsername("legit-import-admin");
    expect(user).not.toBeNull();
    expect(user.instance_admin).toBe(1);
  });

  it("refuses to replay a consumed token for a second account", async () => {
    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({
        userData: { username: "replay-intruder", password, instanceAdmin: true },
        verificationToken: "GOOD-TOKN-HERE",
      })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(await getUserByUsername("replay-intruder")).toBeNull();
  });

  it("still allows non-instance-admin imports without any token", async () => {
    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({ userData: { username: "regular-import-joe", password } })
      .expect(200);

    expect(res.body.success).toBe(true);
    const user = await getUserByUsername("regular-import-joe");
    expect(user).not.toBeNull();
    expect(user.instance_admin).toBe(0);
  });
});

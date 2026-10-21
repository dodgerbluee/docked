/**
 * Regression tests for the access gates on
 * POST /api/auth/create-user-with-config.
 *
 * Two gates protect this public (bootstrap/import) route:
 *  1. Privilege-grant gate: instance-admin creation is only honored when the
 *     caller presents the pending verification token minted by
 *     generateInstanceAdminToken and read out of the container logs; it is
 *     consumed atomically at grant time. Before this gate an anonymous caller
 *     could self-grant instance admin with a bare POST.
 *  2. Account-creation gate: once the instance has an owner, creating plain
 *     accounts requires an authenticated instance admin. While no instance
 *     admin exists (the bootstrap window) member imports may be anonymous, so
 *     the import order (members before the admin) still works.
 *
 * Uses a dedicated DATA_DIR so the bootstrap state is deterministic and
 * isolated from other suites that seed an instance admin.
 */
process.env.DATA_DIR = `${require("os").tmpdir()}/docked-test-data-cuw`;

const request = require("supertest");
const app = require("../../server");
const { getDatabase } = require("../../db/connection");
const { getUserByUsername } = require("../../db/index");
const { generateToken } = require("../../utils/jwt");

function setPendingToken(username, token) {
  return new Promise((resolve, reject) => {
    getDatabase().run(
      "INSERT OR REPLACE INTO pending_auth_tokens (kind, username, token, created_at) VALUES ('instance_admin', ?, ?, CURRENT_TIMESTAMP)",
      [username, token],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

describe("POST /api/auth/create-user-with-config gates", () => {
  const password = "testpass-1234";

  beforeAll(async () => {
    // Wait for startup init so the users/settings tables exist on a fresh tmpdir.
    const { waitForDatabaseInit } = require("../../db/connection");
    await waitForDatabaseInit();

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

  // --- Account-creation gate: bootstrap window (no owner yet) ---
  it("allows anonymous member import while no instance admin exists", async () => {
    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({ userData: { username: "bootstrap-member", password } })
      .expect(200);

    expect(res.body.success).toBe(true);
    const user = await getUserByUsername("bootstrap-member");
    expect(user).not.toBeNull();
    expect(user.instance_admin).toBe(0);
  });

  // --- Privilege-grant gate ---
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

  // --- Account-creation gate: window closed (owner now exists) ---
  it("rejects anonymous member import once an instance admin exists", async () => {
    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .send({ userData: { username: "post-bootstrap-member", password } })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(await getUserByUsername("post-bootstrap-member")).toBeNull();
  });

  it("allows member import when an authenticated instance admin calls it", async () => {
    const admin = await getUserByUsername("legit-import-admin");
    const token = generateToken({ userId: admin.id, username: admin.username, role: admin.role });

    const res = await request(app)
      .post("/api/auth/create-user-with-config")
      .set("Authorization", `Bearer ${token}`)
      .send({ userData: { username: "authed-member", password } })
      .expect(200);

    expect(res.body.success).toBe(true);
    const user = await getUserByUsername("authed-member");
    expect(user).not.toBeNull();
    expect(user.instance_admin).toBe(0);
  });
});

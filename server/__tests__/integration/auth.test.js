/**
 * Integration tests for authentication endpoints
 */

const request = require("supertest");
const app = require("../../server");
// const { getUserByUsername, updatePassword } = require("../../db/index"); // Unused
// const bcrypt = require("bcrypt"); // Unused

describe("Authentication API", () => {
  let authToken;
  const testUsername = "admin";
  const testPassword = process.env.ADMIN_PASSWORD || "admin";

  beforeAll(async () => {
    // On a fresh CI tmpdir the DB file has no tables yet; server.js defers
    // initializeDatabase via setImmediate, so wait for it before touching the DB.
    const { waitForDatabaseInit } = require("../../db/connection");
    await waitForDatabaseInit();

    // Create a test admin user if it doesn't exist
    const { createUser, getUserByUsername: getUserByUsernameLocal } = require("../../db/index");
    try {
      const existingUser = await getUserByUsernameLocal(testUsername);
      if (!existingUser) {
        await createUser(testUsername, testPassword, null, "Administrator", true, false);
      }
    } catch (error) {
      // User might already exist, which is fine
      if (!error.message.includes("UNIQUE constraint")) {
        throw error;
      }
    }

    // Get auth token for tests that need it
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: testUsername,
      password: testPassword,
    });

    if (loginResponse.status === 200) {
      authToken = loginResponse.body.token;
    } else {
      throw new Error(`Failed to get auth token: ${JSON.stringify(loginResponse.body)}`);
    }
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe("POST /api/auth/login", () => {
    it("should login with valid credentials", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({
          username: "admin",
          password: process.env.ADMIN_PASSWORD || "admin",
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.username).toBe("admin");
      authToken = response.body.token;
    });

    it("should reject login with invalid credentials", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({
          username: "admin",
          password: "wrongpassword",
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it("should reject login with missing fields", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({
          username: "admin",
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe("GET /api/auth/verify", () => {
    it("should verify valid token", async () => {
      const response = await request(app)
        .get("/api/auth/verify")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.username).toBeDefined();
    });

    it("should reject request without token", async () => {
      const response = await request(app).get("/api/auth/verify").expect(401);

      expect(response.body.error).toBeDefined();
    });

    it("should reject invalid token", async () => {
      const response = await request(app)
        .get("/api/auth/verify")
        .set("Authorization", "Bearer invalid-token")
        .expect(401);

      expect(response.body.error).toBeDefined();
    });
  });

  describe("GET /api/auth/me", () => {
    // Route pruned in the auth/users graph cutover: current-user reads are
    // served by the GraphQL `me` query. The 404 assertion is a tombstone so
    // the route can never silently come back.
    it("is retired and returns 404", async () => {
      await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(404);
    });
  });
});

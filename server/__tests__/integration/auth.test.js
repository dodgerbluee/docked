/**
 * Integration tests for authentication endpoints
 */

const request = require("supertest");
const app = require("../../server");
const { getUserByUsername, updatePassword } = require("../../db/database");
const bcrypt = require("bcrypt");

describe("Authentication API", () => {
  let authToken;
  let testUsername = "admin";
  let testPassword = process.env.ADMIN_PASSWORD || "admin";

  beforeAll(async () => {
    // Create a test admin user if it doesn't exist
    const { createUser, getUserByUsername } = require("../../db/database");
    try {
      const existingUser = await getUserByUsername(testUsername);
      if (!existingUser) {
        await createUser(testUsername, testPassword, null, "Administrator", true, false);
      }
    } catch (error) {
      // User might already exist, which is fine
      if (!error.message.includes("UNIQUE constraint")) {
        throw error;
      }
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
    it("should get current user with valid token", async () => {
      const response = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.username).toBeDefined();
    });

    it("should reject request without authentication", async () => {
      const response = await request(app).get("/api/auth/me").expect(401);

      expect(response.body.error).toBeDefined();
    });
  });
});

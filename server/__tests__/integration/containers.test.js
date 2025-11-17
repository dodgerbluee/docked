/**
 * Integration tests for container endpoints
 */

const request = require("supertest");
const app = require("../../server");

describe("Containers API", () => {
  let authToken;

  beforeAll(async () => {
    // Create a test admin user if it doesn't exist
    const { createUser, getUserByUsername } = require("../../db/database");
    const testUsername = "admin";
    const testPassword = process.env.ADMIN_PASSWORD || "admin";
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

    // Get auth token
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: testUsername,
      password: testPassword,
    });

    if (loginResponse.status !== 200) {
      throw new Error(`Login failed: ${JSON.stringify(loginResponse.body)}`);
    }

    authToken = loginResponse.body.token;
  });

  describe("GET /api/containers", () => {
    it("should require authentication", async () => {
      const response = await request(app).get("/api/containers").expect(401);

      expect(response.body.error).toBeDefined();
    });

    it("should return containers with valid token", async () => {
      const response = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
      // Response structure may vary, but should be defined
    });
  });
});

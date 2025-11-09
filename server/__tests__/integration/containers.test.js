/**
 * Integration tests for container endpoints
 */

const request = require('supertest');
const app = require('../../server');

describe('Containers API', () => {
  let authToken;

  beforeAll(async () => {
    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin',
      });
    
    authToken = loginResponse.body.token;
  });

  describe('GET /api/containers', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/containers')
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('should return containers with valid token', async () => {
      const response = await request(app)
        .get('/api/containers')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
      // Response structure may vary, but should be defined
    });
  });
});


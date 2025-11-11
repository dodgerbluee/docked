/**
 * Swagger/OpenAPI Configuration
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Docked API',
      version: '1.0.0',
      description: 'API documentation for Docked - Docker container management application',
      contact: {
        name: 'API Support',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3001',
        description: 'Development server',
      },
      {
        url: 'https://yourdomain.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'string',
              example: 'Error message',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1,
            },
            username: {
              type: 'string',
              example: 'admin',
            },
            role: {
              type: 'string',
              example: 'Administrator',
            },
          },
        },
        Container: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              example: 'abc123def456',
            },
            name: {
              type: 'string',
              example: 'my-container',
            },
            image: {
              type: 'string',
              example: 'nginx:latest',
            },
            status: {
              type: 'string',
              example: 'running',
            },
            hasUpdate: {
              type: 'boolean',
              example: true,
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./routes/*.js', './controllers/*.js'], // Path to the API files
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;


/**
 * Swagger/OpenAPI Configuration
 */

const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Docked API",
      version: "1.0.0",
      description: "API documentation for Docked - Docker container management application",
      contact: {
        name: "API Support",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: process.env.API_URL || "http://localhost:3001",
        description: "Development server",
      },
      {
        url: "https://yourdomain.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained from /api/auth/login",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            error: {
              type: "string",
              example: "Error message",
            },
          },
        },
        User: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              example: 1,
            },
            username: {
              type: "string",
              example: "admin",
            },
            role: {
              type: "string",
              example: "Administrator",
            },
          },
        },
        Container: {
          type: "object",
          properties: {
            id: {
              type: "string",
              example: "abc123def456",
            },
            containerId: {
              type: "string",
              example: "abc123def456",
            },
            containerName: {
              type: "string",
              example: "my-container",
            },
            imageName: {
              type: "string",
              example: "nginx:latest",
            },
            imageRepo: {
              type: "string",
              example: "nginx",
            },
            status: {
              type: "string",
              example: "running",
            },
            state: {
              type: "string",
              example: "running",
            },
            hasUpdate: {
              type: "boolean",
              example: true,
            },
            stackName: {
              type: "string",
              nullable: true,
              example: "my-stack",
            },
            portainerUrl: {
              type: "string",
              example: "http://portainer:9000",
            },
          },
        },
        PortainerInstance: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              example: 1,
            },
            url: {
              type: "string",
              example: "http://portainer:9000",
            },
            name: {
              type: "string",
              example: "Local Portainer",
            },
            authType: {
              type: "string",
              enum: ["apikey", "basic"],
              example: "apikey",
            },
            displayOrder: {
              type: "integer",
              example: 0,
            },
          },
        },
        TrackedApp: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              example: 1,
            },
            name: {
              type: "string",
              example: "My App",
            },
            imageName: {
              type: "string",
              nullable: true,
              example: "nginx:latest",
            },
            githubRepo: {
              type: "string",
              nullable: true,
              example: "owner/repo",
            },
            sourceType: {
              type: "string",
              enum: ["docker", "github"],
              example: "docker",
            },
            currentVersion: {
              type: "string",
              nullable: true,
            },
            latestVersion: {
              type: "string",
              nullable: true,
            },
            hasUpdate: {
              type: "boolean",
              example: false,
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
  apis: ["./routes/*.js", "./controllers/*.js"], // Path to the API files
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

# Architecture Documentation

**Last Updated:** 2025-01-27

This document describes the architecture of the Docked backend application, including design patterns, module organization, and key architectural decisions.

## Table of Contents

- [Overview](#overview)
- [Architecture Layers](#architecture-layers)
- [Directory Structure](#directory-structure)
- [Design Patterns](#design-patterns)
- [Database Architecture](#database-architecture)
- [Service Layer](#service-layer)
- [Repository Pattern](#repository-pattern)
- [Error Handling](#error-handling)
- [Authentication & Authorization](#authentication--authorization)
- [API Design](#api-design)

## Overview

Docked is a Node.js/Express backend application for managing Docker containers through Portainer instances. The application follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────┐
│         Controllers Layer            │  HTTP request/response handling
├─────────────────────────────────────┤
│         Services Layer               │  Business logic & orchestration
├─────────────────────────────────────┤
│      Repositories Layer              │  Data access abstraction
├─────────────────────────────────────┤
│      Database Layer                  │  SQLite database
└─────────────────────────────────────┘
```

## Architecture Layers

### 1. Controllers Layer (`server/controllers/`)

**Purpose:** Handle HTTP requests and responses, input validation, and delegate to services.

**Responsibilities:**

- Parse and validate request data
- Call appropriate service methods
- Format responses using response formatter middleware
- Handle HTTP-specific concerns (status codes, headers)

**Key Files:**

- `containerController.js` - Container management endpoints
- `portainerController.js` - Portainer instance management
- `authController.js` - Authentication and user management
- `batchController.js` - Batch job management

**Example:**

```javascript
async function getContainers(req, res) {
  const containers = await containerQueryService.getContainers(req.user.id);
  res.json({ success: true, containers });
}
```

### 2. Services Layer (`server/services/`)

**Purpose:** Implement business logic, orchestrate operations, and coordinate between repositories.

**Responsibilities:**

- Business logic implementation
- Data transformation and enrichment
- Orchestration of multiple repository calls
- External API integration (Portainer, Docker Hub, GitHub)
- Complex workflows (container upgrades, batch operations)

**Key Services:**

- `containerQueryService.js` - Container querying and data aggregation
- `containerUpgradeService.js` - Container upgrade workflows
- `portainerService.js` - Portainer API integration
- `batch/index.js` - Batch job scheduling and execution

**Service Modularization:**
Large services have been split into focused sub-services:

- `ContainerGroupingService` - Container grouping logic
- `ContainerPersistenceService` - Container data persistence
- `ContainerNotificationService` - Notification handling
- `ContainerProcessingService` - Container processing workflows
- `ContainerDataService` - Container data operations
- `ContainerQueryOrchestrationService` - Query orchestration

### 3. Repositories Layer (`server/repositories/`)

**Purpose:** Abstract database access, provide data access methods, and implement caching.

**Responsibilities:**

- Database query execution
- Data mapping and transformation
- Query result caching
- Transaction management
- Error handling for database operations

**Base Repository:**
All repositories extend `BaseRepository`, which provides:

- Common database operations (`findOne`, `findAll`, `execute`, `transaction`)
- Query result caching (5-minute TTL)
- Consistent error handling
- Database connection management

**Repository List:**

- `UserRepository` - User data access
- `ContainerRepository` - Container data access
- `PortainerInstanceRepository` - Portainer instance data access
- `TrackedAppRepository` - Tracked application data access
- `DiscordRepository` - Discord webhook data access
- `BatchRepository` - Batch job data access
- `SettingsRepository` - Settings data access
- `RegistryRepository` - Registry data access
- `DockerHubImageVersionRepository` - Docker Hub image versions
- `DeployedImageRepository` - Deployed image tracking
- `RegistryImageVersionRepository` - Registry image versions

**Example:**

```javascript
class UserRepository extends BaseRepository {
  async findAll() {
    return this.findAll("SELECT * FROM users WHERE deleted = 0", [], {
      cache: true,
      cacheKey: "users:all",
    });
  }
}
```

### 4. Database Layer (`server/db/`)

**Purpose:** Database connection, initialization, schema management, and migrations.

**Structure:**

```
server/db/
├── connection.js          # Database connection & initialization
├── migrations/            # Database migrations
│   ├── index.js          # Migration runner
│   ├── helpers.js         # Migration helper functions
│   └── 0001_*.js         # Individual migration files
└── [domain modules]/     # Domain-specific database functions
```

**Key Features:**

- SQLite database with connection pooling
- Database operation queueing for thread safety
- Automatic schema initialization
- Versioned migrations with auto-discovery
- 40+ database indexes for performance

## Directory Structure

```
server/
├── controllers/          # HTTP request handlers
├── services/            # Business logic layer
│   ├── batch/           # Batch job system
│   └── registry/        # Registry providers
├── repositories/        # Data access layer
├── db/                  # Database layer
│   ├── connection.js   # Connection management
│   └── migrations/      # Schema migrations
├── middleware/         # Express middleware
│   ├── auth.js         # Authentication
│   ├── errorHandler.js # Error handling
│   └── validation.js   # Input validation
├── routes/             # Route definitions
├── utils/              # Utility functions
│   ├── errors.js      # Custom error classes
│   └── logger.js      # Logging utility
├── config/             # Configuration
└── constants/          # Application constants
```

## Design Patterns

### 1. Repository Pattern

**Purpose:** Abstract database access and provide a consistent interface.

**Benefits:**

- Testability (easy to mock repositories)
- Flexibility (can swap database implementations)
- Caching (centralized caching logic)
- Consistency (common operations standardized)

**Implementation:**

- `BaseRepository` provides common operations
- Domain-specific repositories extend `BaseRepository`
- Repositories are singletons exported from `server/repositories/index.js`

### 2. Service Layer Pattern

**Purpose:** Encapsulate business logic separate from HTTP and data access concerns.

**Benefits:**

- Reusability (services can be used by multiple controllers)
- Testability (business logic isolated and testable)
- Maintainability (clear separation of concerns)

### 3. Dependency Injection

**Purpose:** Loose coupling between modules.

**Implementation:**

- Services receive dependencies via constructor or function parameters
- Repositories are injected into services
- Controllers receive services via `require()`

### 4. Middleware Pattern

**Purpose:** Cross-cutting concerns (authentication, validation, error handling).

**Key Middleware:**

- `authenticate` - JWT token validation
- `asyncHandler` - Async error handling wrapper
- `validate` - Input validation using express-validator
- `responseFormatter` - Consistent response formatting

## Database Architecture

### Connection Management

**File:** `server/db/connection.js`

**Features:**

- Single database connection instance
- Operation queueing for thread safety
- Automatic initialization on first access
- Schema creation and migration execution

**Queue System:**
Database operations are queued to prevent SQLite's "database is locked" errors:

```javascript
const queue = [];
let isProcessingQueue = false;

async function queueDatabaseOperation(operation) {
  return new Promise((resolve, reject) => {
    queue.push({ operation, resolve, reject });
    processQueue();
  });
}
```

### Migrations

**File:** `server/db/migrations/`

**System:**

- File-based migrations (one file per migration)
- Auto-discovery from `server/db/migrations/` directory
- Version tracking in `schema_migrations` table
- Idempotent migrations (safe to run multiple times)

**Naming Convention:**

```
XXXX_description.js
```

Where `XXXX` is a zero-padded 4-digit version number.

**Example:**

- `0001_initial_baseline.js`
- `0002_add_user_email.js`

### Domain Modules

Database functions are organized by domain:

- `users.js` - User-related queries
- `containers.js` - Container-related queries
- `portainerInstances.js` - Portainer instance queries
- `trackedApps.js` - Tracked app queries
- `discord.js` - Discord webhook queries
- `batch.js` - Batch job queries
- `settings.js` - Settings queries
- `registry.js` - Registry queries
- `dockerHubImageVersions.js` - Docker Hub image versions
- `deployedImages.js` - Deployed image tracking
- `registryImageVersions.js` - Registry image versions

## Service Layer

### Service Organization

Services are organized by domain and responsibility:

**Container Services:**

- `containerQueryService.js` - Main query service (orchestrates sub-services)
- `ContainerDataService` - Data operations
- `ContainerQueryOrchestrationService` - Query orchestration
- `ContainerGroupingService` - Grouping logic
- `ContainerPersistenceService` - Persistence operations
- `ContainerNotificationService` - Notifications
- `ContainerProcessingService` - Processing workflows

**Upgrade Services:**

- `containerUpgradeService.js` - Main upgrade service
- `ContainerDetailsService` - Container detail retrieval
- `ContainerConfigService` - Configuration management
- `ContainerReadinessService` - Readiness checks
- `DependentContainerService` - Dependent container handling
- `DependentContainerRestartService` - Dependent container restarts
- `PortainerAuthService` - Portainer authentication
- `PortainerIpFallbackService` - IP fallback logic
- `NginxProxyManagerService` - NPM-specific logic

**Portainer Services:**

- `portainerService.js` - Main Portainer service
- `PortainerAuthService` - Authentication handling

### Service Communication

Services communicate through:

1. **Direct function calls** - Services call other services directly
2. **Repository access** - Services use repositories for data access
3. **Event-driven** (future) - For decoupled communication

## Repository Pattern

### BaseRepository

**File:** `server/repositories/BaseRepository.js`

**Methods:**

- `getDb()` - Get database connection
- `execute(query, params)` - Execute write queries
- `findOne(query, params, options)` - Find single record
- `findAll(query, params, options)` - Find all records
- `transaction(callback)` - Execute transaction
- `invalidateCache(prefix)` - Invalidate cache entries
- `clearCache()` - Clear all cache

**Caching:**

- In-memory cache with 5-minute TTL
- Cache key format: `domain:operation` (e.g., `users:all`)
- Cache invalidation on writes
- Optional caching via `options.cache` and `options.cacheKey`

### Repository Usage

**Example:**

```javascript
const userRepository = require("../repositories").userRepository;

// Find all users (cached)
const users = await userRepository.findAll("SELECT * FROM users WHERE deleted = 0", [], {
  cache: true,
  cacheKey: "users:all",
});

// Find one user
const user = await userRepository.findOne("SELECT * FROM users WHERE id = ?", [userId]);

// Execute write operation
await userRepository.execute("UPDATE users SET username = ? WHERE id = ?", [newUsername, userId]);
```

## Error Handling

### Custom Error Classes

**File:** `server/utils/errors.js`

**Error Types:**

- `AppError` - Base error class
- `NotFoundError` - Resource not found (404)
- `ValidationError` - Validation failures (400)
- `UnauthorizedError` - Authentication failures (401)
- `ForbiddenError` - Authorization failures (403)
- `ConflictError` - Resource conflicts (409)
- `InternalServerError` - Server errors (500)

**Usage:**

```javascript
if (!user) {
  throw new NotFoundError("User not found");
}
```

### Error Middleware

**File:** `server/middleware/errorHandler.js`

**Features:**

- Centralized error handling
- Automatic status code assignment
- Consistent error response format
- Logging of errors

**Response Format:**

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## Authentication & Authorization

### JWT Authentication

**File:** `server/middleware/auth.js`

**Flow:**

1. Client sends JWT token in `Authorization: Bearer <token>` header
2. Middleware validates token signature and expiration
3. User information extracted from token payload
4. `req.user` populated with user data

**Token Structure:**

```javascript
{
  userId: 1,
  username: "admin",
  role: "Administrator"
}
```

### Role-Based Access Control

**Roles:**

- `Administrator` - Full access
- `User` - Limited access (user-specific data)

**Implementation:**

- Role checked in controllers/services
- User data filtered by `userId` in repositories

## API Design

### RESTful Principles

**Endpoints:**

- `GET /api/containers` - List resources
- `GET /api/containers/:id` - Get single resource
- `POST /api/containers` - Create resource
- `PUT /api/containers/:id` - Update resource
- `DELETE /api/containers/:id` - Delete resource

### Response Format

**Success Response:**

```json
{
  "success": true,
  "data": { ... }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": "Error message"
}
```

### Input Validation

**File:** `server/middleware/validation.js`

**Features:**

- Express-validator integration
- Common validation chains
- Automatic error formatting
- Required field validation

## Best Practices

### 1. Error Handling

- Always use `asyncHandler` wrapper for async route handlers
- Throw appropriate custom error classes
- Log errors with context

### 2. Database Operations

- Use repositories for all database access
- Use transactions for multi-step operations
- Enable caching for read-heavy queries
- Invalidate cache on writes

### 3. Service Design

- Keep services focused on single responsibility
- Use dependency injection for testability
- Document service methods with JSDoc

### 4. Code Organization

- Group related functionality in modules
- Use consistent naming conventions
- Keep files under 500 lines
- Keep functions under 50 lines

## Future Improvements

1. **Event System** - Decouple services with event-driven architecture
2. **Caching Strategy** - Implement Redis for distributed caching
3. **Parallel Processing** - Add parallel execution for batch operations
4. **API Versioning** - Implement API versioning strategy
5. **GraphQL** - Consider GraphQL for flexible queries

## Related Documentation

- [API Endpoints](./API_ENDPOINTS.md) - Complete API documentation
- [Database Schema](./DATABASE_SCHEMA.md) - Database schema documentation
- [Implementation Progress](./IMPLEMENTATION_PROGRESS.md) - Current implementation status
- [Code Review](./CODE_REVIEW_BACKEND.md) - Backend code review findings

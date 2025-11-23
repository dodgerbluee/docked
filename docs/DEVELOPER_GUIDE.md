# Developer Guide

**Last Updated:** 2025-01-27

This guide provides practical information for developers working on the Docked backend application.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)
- [Code Style & Standards](#code-style--standards)
- [Testing](#testing)
- [Database Operations](#database-operations)
- [Adding New Features](#adding-new-features)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- SQLite3 (usually bundled with Node.js)
- Git

### Initial Setup

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd docked
   ```

2. **Install dependencies:**

   ```bash
   cd server
   npm install
   ```

3. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Initialize database:**
   The database will be automatically created and initialized on first run.

5. **Start development server:**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3001` (or port specified in `.env`).

## Development Setup

### Environment Variables

Create a `.env` file in the `server/` directory:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# JWT Configuration
JWT_SECRET=your-secret-key-here
JWT_REFRESH_SECRET=your-refresh-secret-key-here

# Database
DB_PATH=./data/docked.db

# Logging
LOG_LEVEL=debug

# API Configuration
API_URL=http://localhost:3001
```

### Development Scripts

```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint

# Generate database schema documentation
npm run docs:schema
```

### IDE Setup

**Recommended Extensions (VS Code):**

- ESLint
- Prettier (optional, but recommended)
- Jest (for test running)

**ESLint Configuration:**
The project uses ESLint for code quality. Configuration is in `.eslintrc.js`.

## Project Structure

```
server/
├── controllers/        # HTTP request handlers
├── services/          # Business logic
├── repositories/       # Data access layer
├── db/                # Database layer
├── middleware/        # Express middleware
├── routes/            # Route definitions
├── utils/             # Utility functions
├── config/            # Configuration
└── constants/         # Application constants
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Common Tasks

### Adding a New API Endpoint

1. **Create or update controller:**

   ```javascript
   // server/controllers/myController.js
   const myService = require("../services/myService");

   async function getMyData(req, res) {
     const data = await myService.getData(req.user.id);
     res.json({ success: true, data });
   }

   module.exports = { getMyData };
   ```

2. **Add route:**

   ```javascript
   // server/routes/index.js
   const myController = require("../controllers/myController");

   router.get("/my-endpoint", authenticate, asyncHandler(myController.getMyData));
   ```

3. **Add Swagger documentation:**
   ```javascript
   /**
    * @swagger
    * /my-endpoint:
    *   get:
    *     summary: Get my data
    *     tags: [My Tag]
    *     security:
    *       - bearerAuth: []
    *     responses:
    *       200:
    *         description: Success
    */
   router.get("/my-endpoint", ...);
   ```

### Adding a New Service

1. **Create service file:**

   ```javascript
   // server/services/myService.js
   const myRepository = require("../repositories").myRepository;

   async function getData(userId) {
     return await myRepository.findByUser(userId);
   }

   module.exports = { getData };
   ```

2. **Use in controller:**
   ```javascript
   const myService = require("../services/myService");
   ```

### Adding a New Repository

1. **Create repository:**

   ```javascript
   // server/repositories/MyRepository.js
   const BaseRepository = require("./BaseRepository");

   class MyRepository extends BaseRepository {
     async findByUser(userId) {
       return await this.findAll("SELECT * FROM my_table WHERE user_id = ?", [userId], {
         cache: true,
         cacheKey: `my_table:user:${userId}`,
       });
     }
   }

   module.exports = new MyRepository();
   ```

2. **Export from index:**

   ```javascript
   // server/repositories/index.js
   const myRepository = require("./MyRepository");

   module.exports = {
     // ... other repositories
     myRepository,
   };
   ```

### Creating a Database Migration

1. **Create migration file:**

   ```javascript
   // server/db/migrations/0002_add_my_column.js
   const { addColumnIfNotExists } = require("./helpers");
   const logger = require("../../utils/logger");

   module.exports = {
     version: 2,
     name: "Add my_column to my_table",
     up: async () => {
       logger.info("Migration 2: Adding my_column");
       await addColumnIfNotExists("my_table", "my_column", "TEXT");
     },
   };
   ```

2. **Migration will run automatically on next server start**

See [server/db/migrations/README.md](../server/db/migrations/README.md) for more details.

## Code Style & Standards

### Naming Conventions

- **Files:** `camelCase.js` (e.g., `userService.js`)
- **Classes:** `PascalCase` (e.g., `UserRepository`)
- **Functions:** `camelCase` (e.g., `getUserById`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`)
- **Database tables:** `snake_case` (e.g., `portainer_instances`)

### Code Organization

- **Keep files under 500 lines**
- **Keep functions under 50 lines**
- **One class/object per file**
- **Group related functions in modules**

### Error Handling

Always use `asyncHandler` for async route handlers:

```javascript
const { asyncHandler } = require("../middleware/errorHandler");

router.get(
  "/endpoint",
  asyncHandler(async (req, res) => {
    // Your code here
  })
);
```

Throw appropriate error classes:

```javascript
const { NotFoundError, ValidationError } = require("../utils/errors");

if (!resource) {
  throw new NotFoundError("Resource not found");
}
```

### Logging

Use structured logging:

```javascript
const logger = require("../utils/logger");

logger.info("Operation completed", { userId, resourceId });
logger.error("Operation failed", { error: err.message, userId });
```

### Comments & Documentation

- Use JSDoc for function documentation:

  ```javascript
  /**
   * Get user by ID
   * @param {number} userId - User ID
   * @returns {Promise<Object>} User object
   */
  async function getUserById(userId) {
    // ...
  }
  ```

- Add comments for complex logic
- Keep comments up-to-date with code changes

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

Tests are located in `server/__tests__/`:

```javascript
// server/__tests__/myService.test.js
const myService = require("../services/myService");

describe("MyService", () => {
  test("should get data", async () => {
    const data = await myService.getData(1);
    expect(data).toBeDefined();
  });
});
```

### Test Structure

- Unit tests: Test individual functions/modules
- Integration tests: Test multiple components together
- Use mocks for external dependencies

## Database Operations

### Using Repositories

Always use repositories for database access:

```javascript
const { userRepository } = require("../repositories");

// Find all users (cached)
const users = await userRepository.findAll();

// Find one user
const user = await userRepository.findById(userId);

// Create user
await userRepository.create(userData);

// Update user
await userRepository.update(userId, updateData);
```

### Using Caching

Enable caching for read-heavy queries:

```javascript
// Cache enabled
const users = await userRepository.findAll("SELECT * FROM users", [], {
  cache: true,
  cacheKey: "users:all",
});

// Cache disabled (default)
const user = await userRepository.findOne("SELECT * FROM users WHERE id = ?", [userId]);
```

**Cache Invalidation:**

```javascript
// Invalidate specific cache entries
BaseRepository.invalidateCache("users:");

// Clear all cache
BaseRepository.clearCache();
```

### Transactions

Use transactions for multi-step operations:

```javascript
await userRepository.transaction(async (db) => {
  await userRepository.execute("INSERT INTO users ...", []);
  await userRepository.execute("INSERT INTO settings ...", []);
});
```

### Direct Database Access

Avoid direct database access. If necessary, use the connection module:

```javascript
const { getDatabase, queueDatabaseOperation } = require("../db/connection");

await queueDatabaseOperation(() => {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.run("SQL HERE", params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});
```

## Adding New Features

### Feature Checklist

1. ✅ Create database migration (if schema changes needed)
2. ✅ Create/update repository methods
3. ✅ Create/update service methods
4. ✅ Create/update controller methods
5. ✅ Add routes with authentication
6. ✅ Add input validation
7. ✅ Add Swagger documentation
8. ✅ Add error handling
9. ✅ Add logging
10. ✅ Write tests

### Example: Adding a New Feature

**Feature:** Add ability to favorite containers

1. **Database migration:**

   ```javascript
   // server/db/migrations/0002_add_favorite_column.js
   await addColumnIfNotExists("containers", "is_favorite", "INTEGER DEFAULT 0");
   ```

2. **Repository method:**

   ```javascript
   // server/repositories/ContainerRepository.js
   async setFavorite(containerId, userId, isFavorite) {
     return await this.execute(
       "UPDATE containers SET is_favorite = ? WHERE container_id = ? AND user_id = ?",
       [isFavorite ? 1 : 0, containerId, userId]
     );
   }
   ```

3. **Service method:**

   ```javascript
   // server/services/containerService.js
   async setFavorite(containerId, userId, isFavorite) {
     await containerRepository.setFavorite(containerId, userId, isFavorite);
     BaseRepository.invalidateCache("containers:");
   }
   ```

4. **Controller method:**

   ```javascript
   // server/controllers/containerController.js
   async setFavorite(req, res) {
     const { containerId } = req.params;
     const { isFavorite } = req.body;
     await containerService.setFavorite(containerId, req.user.id, isFavorite);
     res.json({ success: true });
   }
   ```

5. **Route:**
   ```javascript
   router.put("/containers/:containerId/favorite",
     authenticate,
     validate([...]),
     asyncHandler(containerController.setFavorite)
   );
   ```

## Debugging

### Logging

Use appropriate log levels:

```javascript
logger.debug("Detailed debug information");
logger.info("General information");
logger.warn("Warning message");
logger.error("Error occurred", { error: err });
```

### Database Debugging

Enable SQL logging:

```javascript
// In connection.js, enable SQL logging
db.on("trace", (sql) => {
  logger.debug("SQL:", sql);
});
```

### Common Issues

**"Database is locked" error:**

- Ensure all database operations use `queueDatabaseOperation`
- Check for long-running transactions

**Cache not updating:**

- Check if cache is being invalidated after writes
- Verify cache key format

**Authentication issues:**

- Check JWT token expiration
- Verify `JWT_SECRET` in `.env`

## Troubleshooting

### Server Won't Start

1. Check Node.js version: `node --version` (should be 18+)
2. Check dependencies: `npm install`
3. Check environment variables: `.env` file exists and is valid
4. Check database: Database file is writable
5. Check port: Port 3001 (or configured port) is available

### Database Issues

1. **Database file locked:**
   - Stop all running instances
   - Check for file permissions
   - Restart server

2. **Migration errors:**
   - Check migration file syntax
   - Verify database version
   - Check migration logs

3. **Connection errors:**
   - Verify `DB_PATH` in `.env`
   - Check file permissions
   - Ensure SQLite3 is installed

### Performance Issues

1. **Slow queries:**
   - Check database indexes
   - Enable query logging
   - Review query execution plans

2. **Memory issues:**
   - Check for memory leaks
   - Review cache size
   - Monitor database connection pool

### Getting Help

1. Check existing documentation:
   - [ARCHITECTURE.md](./ARCHITECTURE.md)
   - [API_ENDPOINTS.md](./API_ENDPOINTS.md)
   - [CODE_REVIEW_BACKEND.md](./CODE_REVIEW_BACKEND.md)

2. Review code examples in similar files

3. Check error logs for detailed error messages

## Best Practices

1. **Always use repositories** for database access
2. **Enable caching** for read-heavy queries
3. **Use transactions** for multi-step operations
4. **Handle errors** with appropriate error classes
5. **Log important operations** with context
6. **Validate input** before processing
7. **Write tests** for new features
8. **Update documentation** when adding features
9. **Follow naming conventions** consistently
10. **Keep functions small** and focused

## Related Documentation

- [Architecture Guide](./ARCHITECTURE.md) - System architecture overview
- [API Endpoints](./API_ENDPOINTS.md) - Complete API documentation
- [Database Schema](./DATABASE_SCHEMA.md) - Database schema documentation
- [Implementation Progress](./IMPLEMENTATION_PROGRESS.md) - Current status

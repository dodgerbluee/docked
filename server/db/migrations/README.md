# Database Migrations

This directory contains database schema migrations. Each migration is a separate file that applies a specific schema change.

## Migration File Naming

Migrations must follow this naming pattern:

```
XXXX_description.js
```

Where:

- `XXXX` is a 4-digit zero-padded version number (e.g., `0001`, `0002`, `0010`)
- `description` is a short, descriptive name using underscores (e.g., `add_user_email`, `create_indexes`)

Examples:

- `0001_initial_baseline.js`
- `0002_add_user_email.js`
- `0003_create_container_indexes.js`

## Creating a New Migration

1. **Create a new file** following the naming pattern above
2. **Export a migration object** with:
   - `version`: Number matching the filename prefix
   - `name`: Human-readable description
   - `up`: Async function that applies the migration

Example:

```javascript
// server/db/migrations/0002_add_user_email.js
const { addColumnIfNotExists } = require("./helpers");

module.exports = {
  version: 2,
  name: "Add email column to users table",
  up: async () => {
    await addColumnIfNotExists("users", "email", "TEXT");
  },
};
```

## Migration Helpers

Use helper functions from `helpers.js` to make migrations more readable:

- `columnExists(tableName, columnName)` - Check if a column exists
- `addColumnIfNotExists(tableName, columnName, definition)` - Add a column safely
- `tableExists(tableName)` - Check if a table exists
- `indexExists(indexName)` - Check if an index exists
- `createIndexIfNotExists(indexName, tableName, columns, unique)` - Create an index safely
- `executeSql(sql, params)` - Execute raw SQL (use with caution)

## Migration Execution

Migrations are automatically discovered and executed in order by `index.js`:

1. Migrations are loaded from this directory
2. Sorted by version number (from filename)
3. Only pending migrations (version > current DB version) are executed
4. Applied migrations are recorded in `schema_migrations` table

## Best Practices

1. **Always use helpers** - Use `addColumnIfNotExists` instead of raw `ALTER TABLE`
2. **Make migrations idempotent** - They should be safe to run multiple times
3. **Test migrations** - Test on a copy of production data before deploying
4. **Keep migrations small** - One logical change per migration
5. **Document breaking changes** - Add comments for any data migrations or breaking changes
6. **Never modify existing migrations** - Once applied, migrations should not be changed. Create a new migration to fix issues.

## Migration Structure

```javascript
/**
 * Migration X: Description
 *
 * Brief description of what this migration does.
 *
 * Version: X
 * Date: YYYY-MM-DD
 */

const { helperFunction } = require("./helpers");
const logger = require("../../utils/logger");

module.exports = {
  version: X,
  name: "Human readable description",
  up: async () => {
    // Migration logic here
    logger.info("Migration X: Description - starting");

    // Use helpers for common operations
    await helperFunction(...);

    logger.info("Migration X: Description - completed");
  },
};
```

## Rollback

Currently, this migration system only supports "up" migrations (forward). To rollback:

1. Restore from a database backup
2. Or create a new migration that reverses the changes

Future enhancement: Add `down` migration support for reversible migrations.

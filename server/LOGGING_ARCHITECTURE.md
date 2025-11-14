# Logging Architecture

## Overview

This document describes the centralized, structured logging system implemented across the Docked backend. The logging architecture provides production-grade observability with consistent, contextual, and performance-safe logging throughout the application.

## Architecture Components

### 1. Centralized Logger (`server/utils/logger.js`)

The centralized logger is built on Winston and provides:

- **Structured JSON logging** for production environments
- **Human-readable console logging** for development
- **Contextual metadata** (requestId, userId, jobId, batchId, module, service)
- **Automatic sensitive data redaction** (passwords, tokens, API keys, etc.)
- **Performance-safe DEBUG logging** with lazy evaluation
- **Dynamic log level control** (updates from database every 5 seconds)

#### Key Features

**Context Support:**
- Uses AsyncLocalStorage for request-scoped context
- Automatically includes requestId, userId, jobId, batchId in all logs
- Supports child loggers with additional context

**Sensitive Data Redaction:**
- Automatically redacts fields matching patterns: password, token, secret, api_key, auth_token, etc.
- Recursively processes nested objects
- Prevents accidental exposure of credentials in logs

**Performance Optimization:**
- DEBUG logs are disabled unless debug mode is explicitly enabled
- Supports lazy evaluation: `logger.debug('message', () => expensiveOperation())`
- Early return if debug is disabled, avoiding expensive serialization

### 2. Request Lifecycle Logging (`server/middleware/requestLogger.js`)

Middleware that:
- Generates unique requestId for each request
- Logs request start with method, URL, IP, userAgent
- Logs request completion with status code, duration, and outcome
- Automatically includes requestId in all logs within the request context

### 3. Batch System Logger (`server/services/batch/Logger.js`)

Wrapper around centralized logger that:
- Maintains in-memory log storage for batch job logs
- Adds jobType and jobId context automatically
- Provides backward compatibility with existing batch system code
- Delegates to centralized logger for actual output

## Log Levels

### INFO
**Purpose:** Operations, state transitions, meaningful events

**Examples:**
- Request lifecycle events
- Container upgrade operations
- Batch job execution
- External API calls
- Database operations

**Usage:**
```javascript
logger.info('Container upgrade started', {
  module: 'containerService',
  operation: 'upgradeSingleContainer',
  containerName: 'my-container',
  image: 'nginx:latest',
});
```

### DEBUG
**Purpose:** Internal state, data structures, variables, low-level debugging

**Examples:**
- Variable values
- Function parameters
- Internal state transitions
- Detailed execution flow
- Cache hits/misses

**Usage:**
```javascript
// Simple metadata
logger.debug('Cache lookup', {
  module: 'containerService',
  key: cacheKey,
  hit: true,
});

// Lazy evaluation for performance
logger.debug('Expensive operation', () => ({
  module: 'containerService',
  result: expensiveComputation(),
  details: getDetailedState(),
}));
```

### WARN
**Purpose:** Warning conditions that don't prevent operation

**Examples:**
- Rate limit approaching
- Fallback to alternative method
- Non-critical errors
- Deprecated feature usage

**Usage:**
```javascript
logger.warn('Rate limit approaching', {
  module: 'dockerRegistryService',
  remaining: 10,
  resetAt: '2024-01-01T00:00:00Z',
});
```

### ERROR
**Purpose:** Error conditions that affect operation

**Examples:**
- Failed API calls
- Database errors
- Validation failures
- External service errors

**Usage:**
```javascript
logger.error('Failed to authenticate Portainer instance', {
  module: 'portainerService',
  portainerUrl: 'https://portainer.example.com',
  error: error, // Error object automatically extracts message, stack, code
});
```

### CRITICAL
**Purpose:** Critical errors that may cause system failure

**Examples:**
- Server startup failures
- Database connection failures
- Critical service unavailability

**Usage:**
```javascript
logger.critical('Failed to start server', {
  module: 'server',
  error: error,
  port: 3001,
});
```

## Standard Log Fields

All logs include these standard fields:

- `timestamp` - ISO 8601 timestamp with milliseconds
- `level` - Log level (info, debug, warn, error, critical)
- `message` - Human-readable log message
- `module` - Module/service name (e.g., 'containerService', 'portainerController')
- `service` - Service identifier (e.g., 'batch', 'api')
- `requestId` - Unique request identifier (if in request context)
- `userId` - User ID (if authenticated)
- `jobId` - Batch job ID (if in batch context)
- `batchId` - Batch run ID (if in batch context)

## Usage Patterns

### Basic Logging

```javascript
const logger = require('../utils/logger');

// INFO log
logger.info('Operation completed', {
  module: 'myModule',
  operation: 'processData',
  recordCount: 100,
});

// DEBUG log (performance-safe)
logger.debug('Processing record', {
  module: 'myModule',
  recordId: record.id,
  status: record.status,
});

// ERROR log
logger.error('Operation failed', {
  module: 'myModule',
  operation: 'processData',
  error: error, // Error object
});
```

### Contextual Logging

```javascript
// Create child logger with additional context
const childLogger = logger.child({
  module: 'containerService',
  operation: 'upgradeContainer',
  containerId: 'abc123',
});

// All logs from childLogger automatically include the context
childLogger.info('Starting upgrade');
childLogger.debug('Container details', { details: containerDetails });
```

### Request Context

The request logger middleware automatically adds requestId to all logs within a request:

```javascript
// In a controller
async function myController(req, res, next) {
  // req.requestId is automatically available
  logger.info('Processing request', {
    module: 'myController',
    // requestId is automatically included from context
  });
}
```

### Batch Job Context

```javascript
const BatchLogger = require('./Logger');
const batchLogger = new BatchLogger('docker-hub-pull', jobId);

// All logs automatically include jobType and jobId
batchLogger.info('Starting job');
batchLogger.debug('Job configuration', { config: jobConfig });
```

## Log Output Formats

### Development (Console)
```
2024-01-01 12:00:00.123 [INFO] [containerService] [req:abc12345] Starting container upgrade containerName=my-container image=nginx:latest
```

### Production (JSON)
```json
{
  "timestamp": "2024-01-01 12:00:00.123",
  "level": "info",
  "message": "Starting container upgrade",
  "module": "containerService",
  "operation": "upgradeSingleContainer",
  "requestId": "abc12345",
  "containerName": "my-container",
  "image": "nginx:latest"
}
```

## Log Files

Logs are written to `logs/` directory:

- `combined.log` - All logs
- `error.log` - Error and critical logs only
- `exceptions.log` - Uncaught exceptions
- `rejections.log` - Unhandled promise rejections

Log files are rotated:
- Max size: 10MB
- Max files: 5
- Oldest files are deleted when limit is reached

## Performance Considerations

1. **DEBUG Logging:**
   - Disabled by default in production
   - Early return if debug is disabled
   - Supports lazy evaluation to avoid expensive operations

2. **Structured Logging:**
   - JSON serialization is efficient
   - Metadata objects are shallow-copied
   - Sensitive data redaction is optimized

3. **Context Storage:**
   - Uses AsyncLocalStorage (native Node.js)
   - Minimal overhead
   - Automatically cleaned up after request

## Best Practices

1. **Always include module and operation:**
   ```javascript
   logger.info('Message', {
     module: 'myModule',
     operation: 'myOperation',
     // ... other metadata
   });
   ```

2. **Use appropriate log levels:**
   - INFO: What happened (operations, events)
   - DEBUG: How it happened (internal details)
   - WARN: Something unexpected but handled
   - ERROR: Something failed
   - CRITICAL: System-level failures

3. **Include relevant context:**
   - Request IDs for traceability
   - User IDs for audit trails
   - Operation names for filtering
   - Resource identifiers (containerId, imageName, etc.)

4. **Avoid logging sensitive data:**
   - Passwords, tokens, API keys are automatically redacted
   - But avoid including them in metadata when possible

5. **Use lazy evaluation for expensive DEBUG logs:**
   ```javascript
   logger.debug('Expensive operation', () => ({
     result: expensiveComputation(),
   }));
   ```

## Migration Notes

The logging system has been migrated from:
- Emoji-based logs (🔄, ✅, ❌) → Structured messages
- Console.log/error → Centralized logger
- Inconsistent formats → Standard structured format
- No context → Automatic context injection
- No sensitive data protection → Automatic redaction

All existing logging calls have been updated to use the new structured format while maintaining backward compatibility where needed.

## Configuration

Log level can be controlled via:
1. Environment variable: `LOG_LEVEL=debug|info`
2. Database setting: Stored in `settings` table, key `log_level`
3. Dynamic updates: Log level is checked every 5 seconds

Default log levels:
- Production: `info`
- Development: `debug`

## Examples

### Container Upgrade Flow

```javascript
// INFO: Operation started
logger.info('Starting container upgrade', {
  module: 'containerService',
  operation: 'upgradeSingleContainer',
  containerName: 'my-container',
  currentImage: 'nginx:1.20',
  newImage: 'nginx:1.21',
});

// DEBUG: Internal state
logger.debug('Container details retrieved', {
  module: 'containerService',
  containerId: 'abc123',
  status: 'running',
});

// INFO: Progress updates
logger.info('Pulling latest image', {
  module: 'containerService',
  image: 'nginx:1.21',
});

// ERROR: Failure
logger.error('Failed to pull image', {
  module: 'containerService',
  image: 'nginx:1.21',
  error: error,
});
```

### Batch Job Execution

```javascript
const batchLogger = new BatchLogger('docker-hub-pull', jobId);

batchLogger.info('Job started', {
  operation: 'docker-hub-pull',
  instanceCount: 3,
});

batchLogger.debug('Processing instance', {
  operation: 'docker-hub-pull',
  portainerUrl: 'https://portainer.example.com',
  containerCount: 10,
});

batchLogger.error('Job failed', {
  operation: 'docker-hub-pull',
  error: error,
});
```

## Summary

The new logging architecture provides:

✅ **Structured, consistent logging** across all modules  
✅ **Contextual metadata** for traceability  
✅ **Automatic sensitive data protection**  
✅ **Performance-safe DEBUG logging**  
✅ **Production-grade observability**  
✅ **Easy filtering and analysis** via structured JSON  
✅ **Request lifecycle tracking**  
✅ **Batch job logging** with in-memory storage  

All logging follows a single, uniform style that makes it easy to understand system behavior, troubleshoot issues, and monitor production systems.


# Batch System Documentation

## Overview

The batch system is a modular, extensible architecture for running scheduled background jobs. It provides:

- **Modular Architecture**: Clear separation between batch manager, job handlers, scheduler, and logger
- **Extensibility**: Easy to add new batch job types without modifying core logic
- **Robust Scheduling**: Cron-like intervals, retries, error handling, and concurrent execution support
- **Structured Logging**: Comprehensive logging with timestamps, batch type, status, and errors
- **Decoupled Execution**: Jobs run entirely in the backend, independent of the frontend

## Architecture

### Components

1. **BatchManager** (`BatchManager.js`)
   - Central manager for all batch jobs
   - Handles job registration, execution, and coordination
   - Prevents concurrent runs of the same job type

2. **JobHandler** (`JobHandler.js`)
   - Base interface for all batch job handlers
   - Defines contract: `getJobType()`, `getDisplayName()`, `execute()`, `validateConfig()`
   - Ensures consistent job implementation

3. **Scheduler** (`Scheduler.js`)
   - Manages scheduling and execution of batch jobs
   - Supports cron-like intervals
   - Handles retries and error recovery
   - Loads last run times from database on startup

4. **Logger** (`Logger.js`)
   - Structured logging with timestamps, levels, and metadata
   - Supports info, warn, error, and debug levels
   - Provides formatted log output for batch run records

5. **Job Handlers** (`handlers/`)
   - `DockerHubPullHandler.js`: Pulls container update information from Docker Hub
   - `TrackedAppsCheckHandler.js`: Checks tracked app updates

## Adding a New Batch Job Type

To add a new batch job type, follow these steps:

### 1. Create a Job Handler

Create a new file in `server/services/batch/handlers/` that extends `JobHandler`:

```javascript
const JobHandler = require('../JobHandler');
const yourService = require('../../yourService');

class YourJobHandler extends JobHandler {
  getJobType() {
    return 'your-job-type';
  }

  getDisplayName() {
    return 'Your Job Display Name';
  }

  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }

  async execute(context) {
    const { logger } = context;
    const result = {
      itemsChecked: 0,
      itemsUpdated: 0,
      logs: [],
      error: null,
    };

    try {
      logger.info('Starting your job');
      
      // Your job logic here
      const serviceResult = await yourService.doSomething();
      
      result.itemsChecked = serviceResult.items?.length || 0;
      result.itemsUpdated = serviceResult.items?.filter(i => i.updated).length || 0;
      
      logger.info('Job completed successfully', {
        itemsChecked: result.itemsChecked,
        itemsUpdated: result.itemsUpdated,
      });

      return result;
    } catch (err) {
      logger.error('Job failed', {
        error: err.message,
        stack: err.stack,
      });

      result.error = err;
      throw err;
    }
  }
}

module.exports = YourJobHandler;
```

### 2. Register the Handler

Add your handler to `server/services/batch/index.js`:

```javascript
const YourJobHandler = require('./handlers/YourJobHandler');

// Register all job handlers
batchManager.registerHandler(new DockerHubPullHandler());
batchManager.registerHandler(new TrackedAppsCheckHandler());
batchManager.registerHandler(new YourJobHandler()); // Add this line
```

That's it! The new job type will automatically:
- Appear in the batch configuration API
- Be scheduled according to its configuration
- Be available for manual triggering via API
- Have its execution logged and tracked

## API Endpoints

### Get Batch Configuration
```
GET /api/batch/config
```
Returns all batch job configurations.

**Response:**
```json
{
  "success": true,
  "config": {
    "docker-hub-pull": {
      "enabled": true,
      "intervalMinutes": 60
    },
    "tracked-apps-check": {
      "enabled": false,
      "intervalMinutes": 30
    }
  }
}
```

### Update Batch Configuration
```
POST /api/batch/config
Content-Type: application/json

{
  "jobType": "docker-hub-pull",
  "enabled": true,
  "intervalMinutes": 30
}
```

**Response:**
```json
{
  "success": true,
  "config": { ... },
  "message": "Batch configuration updated successfully"
}
```

### Get Batch System Status
```
GET /api/batch/status
```

**Response:**
```json
{
  "success": true,
  "status": {
    "registeredJobs": ["docker-hub-pull", "tracked-apps-check"],
    "runningJobs": [],
    "scheduler": {
      "isRunning": true,
      "isInitialized": true,
      "activeJobTimers": 0,
      "lastRunTimes": {
        "docker-hub-pull": "2025-11-10T02:15:04.000Z",
        "tracked-apps-check": null
      }
    }
  }
}
```

### Trigger Batch Job Manually
```
POST /api/batch/trigger
Content-Type: application/json

{
  "jobType": "docker-hub-pull"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Job docker-hub-pull triggered successfully. Check batch logs for execution details."
}
```

### Get Batch Run History
```
GET /api/batch/runs?limit=20
GET /api/batch/runs/latest
GET /api/batch/runs/latest?byJobType=true
GET /api/batch/runs/:id
```

## Configuration

Batch job configurations are stored in the `batch_config` database table. Each job type has:
- `enabled`: Boolean indicating if the job is enabled
- `intervalMinutes`: Number of minutes between runs (minimum: 1, maximum: 1440)

Configurations can be updated via the API without requiring a server restart.

## Scheduling

The scheduler:
- Checks every 30 seconds for jobs that are due to run
- Loads last run times from the database on startup
- Prevents concurrent runs of the same job type
- Handles errors gracefully with automatic retry after 1 minute
- Updates last run times only after successful completion

## Logging

All batch jobs use structured logging:
- **Timestamp**: ISO 8601 format
- **Level**: info, warn, error, or debug
- **Job Type**: Identifier of the batch job
- **Message**: Human-readable log message
- **Metadata**: Additional context (error details, metrics, etc.)

Logs are:
- Stored in memory during job execution
- Saved to database as part of batch run records
- Output to console with structured format

## Error Handling

- Jobs that fail are marked as "failed" in the database
- Error messages are logged with full stack traces
- Last run time is reset to allow retry after 1 minute
- System continues running even if individual jobs fail
- Rate limit errors are handled specially with user-friendly messages

## Testing

Unit tests are located in `server/services/batch/__tests__/`:
- `JobHandler.test.js`: Tests for base job handler interface
- `Logger.test.js`: Tests for structured logger
- `BatchManager.test.js`: Tests for batch manager

Run tests with:
```bash
npm test -- server/services/batch
```

## Best Practices

1. **Job Handler Design**:
   - Keep handlers focused on a single responsibility
   - Use the logger provided in the context for all logging
   - Return consistent result structure
   - Handle errors gracefully and provide meaningful messages

2. **Configuration**:
   - Set reasonable default intervals
   - Validate configuration in `validateConfig()` method
   - Consider rate limits when setting intervals

3. **Logging**:
   - Use appropriate log levels (info, warn, error, debug)
   - Include relevant metadata in log entries
   - Don't log sensitive information

4. **Error Handling**:
   - Catch and handle specific error types (e.g., rate limits)
   - Provide actionable error messages
   - Don't let job failures crash the system

## Troubleshooting

### Jobs Not Running

1. Check if the job is enabled: `GET /api/batch/config`
2. Check scheduler status: `GET /api/batch/status`
3. Check server logs for errors
4. Verify last run times are being loaded correctly

### Jobs Running Too Frequently

1. Check the configured interval: `GET /api/batch/config`
2. Verify last run times are being updated after completion
3. Check for stuck "running" jobs in the database

### Jobs Failing

1. Check batch run logs: `GET /api/batch/runs/:id`
2. Look for error messages in server logs
3. Verify dependencies (database, external APIs) are available
4. Check rate limits if using external APIs

## Future Enhancements

Potential improvements:
- Job dependencies (run job B after job A completes)
- Priority queues for job execution
- Notification system for failures/completions
- Metrics endpoint for Prometheus/Grafana
- Job retry strategies (exponential backoff, max retries)
- Job cancellation support


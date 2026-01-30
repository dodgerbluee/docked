# Log Reduction Action Plan

## Problem

Logs are being spammed with frequent, low-value messages that make it difficult to see important information. The most egregious example is "Fetching containers from Portainer" appearing every second due to frontend polling.

## Strategy

- Move routine/operational logs from `info` to `debug` level
- Keep important events (errors, warnings, state changes) at `info` level
- Ensure debug mode can be enabled when needed for troubleshooting

## Changes Made

### 1. High-Frequency Polling Logs → DEBUG

**File:** `server/services/containerQueryService.js`

- **Line 410:** `logger.info("Fetching containers from Portainer")` → `logger.debug()`
- **Rationale:** This is called every second by frontend polling. Not useful in normal operation, but helpful for debugging polling issues.

### 2. Routine Container Operations → DEBUG

**File:** `server/services/containerQueryService.js`

- **Line 183:** `logger.info("No cached container data found, fetching from Portainer only")` → `logger.debug()`
- **Rationale:** Routine fallback behavior, not an important event.

### 3. Container Change Detection → Keep INFO (Important Event)

**File:** `server/services/cache/containerCacheService.js`

- **Line 345:** `logger.info("Detected container changes")` → **KEEP AS INFO**
- **Rationale:** This indicates actual state changes that users care about.

### 4. Routine Dependency Checks → DEBUG

**Files:**

- `server/services/containerUpgrade/dependentContainerService.js` (line 98)
- `server/services/containerUpgrade/dependentContainerRestartService.js` (line 838)
- **Change:** `logger.info(" Checking for...")` → `logger.debug()`
- **Rationale:** These are routine checks during upgrade operations, not important events. The actual restart/start operations remain at INFO level.

## Log Level Guidelines

### INFO Level (Keep Visible)

- Errors and warnings
- User-initiated actions (upgrades, pulls, configuration changes)
- State changes (container upgrades completed, new updates detected)
- Important system events (batch jobs started/completed, cache updates)
- Authentication/authorization events

### DEBUG Level (Hidden by Default)

- Routine polling operations
- Cache hits/misses (unless indicating a problem)
- Internal state transitions
- Data fetching operations (unless they fail)
- Detailed operation steps within a larger process

## How to Enable Debug Mode

### Option 1: Environment Variable

```bash
LOG_LEVEL=debug npm start
```

### Option 2: Database Setting

Update the log level in the database (if supported by your admin interface).

### Option 3: Runtime Update

The logger checks for log level changes every 5 seconds, so you can update it dynamically.

## Testing

1. Verify normal operation shows only important logs
2. Enable debug mode and verify detailed logs appear
3. Check that errors/warnings still appear at info level
4. Monitor log file sizes to ensure reduction

## Future Considerations

- Consider adding a "verbose" mode for even more detailed logging
- May want to add log sampling for very high-frequency operations
- Consider structured logging levels (trace, debug, info, warn, error)

/**
 * Intent Schedule Evaluator
 *
 * Evaluates cron-based schedules for intents using the croner library.
 * Determines whether a scheduled intent is due for execution based on
 * its cron expression and last evaluation timestamp.
 *
 * Core invariant: `last_evaluated_at` is always set to the cron trigger
 * time that was processed (not wall-clock time). This guarantees that a
 * given cron point can only trigger execution once.
 */

const { Cron } = require("croner");
const logger = require("../../utils/logger");

/**
 * Validate a cron expression.
 * @param {string} cronExpression - Cron expression string
 * @returns {{ valid: boolean, error?: string, nextRun?: Date }}
 */
function validateCron(cronExpression) {
  try {
    const job = new Cron(cronExpression, { paused: true });
    const nextRun = job.nextRun();
    return {
      valid: true,
      nextRun,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

/**
 * Get the next run time for a cron expression.
 * @param {string} cronExpression - Cron expression string
 * @param {Date} [fromDate] - Calculate next run from this date (default: now)
 * @returns {Date|null} - Next run date, or null if invalid/exhausted
 */
function getNextRun(cronExpression, fromDate) {
  try {
    const job = new Cron(cronExpression, { paused: true });
    return job.nextRun(fromDate || new Date());
  } catch (error) {
    logger.error("Error computing next cron run:", {
      cronExpression,
      error: error.message,
    });
    return null;
  }
}

/**
 * Get the previous run time (the most recent time the cron would have triggered
 * before `beforeDate`).
 *
 * Croner does not have a built-in "previousRun" for paused jobs,
 * so we iterate backwards from `beforeDate` using nextRun() starting from
 * progressively earlier times. This is a bounded search.
 *
 * @param {string} cronExpression - Cron expression
 * @param {Date} [beforeDate] - Find the run before this date (default: now)
 * @returns {Date|null}
 */
function getPreviousRun(cronExpression, beforeDate) {
  try {
    const before = beforeDate || new Date();
    const job = new Cron(cronExpression, { paused: true });

    // Search backwards: start from 1 year ago, step forward to find the last run before `before`
    const searchStart = new Date(before.getTime() - 365 * 24 * 60 * 60 * 1000);
    let lastRun = null;
    let current = searchStart;

    // Safety limit: max 1000 iterations
    for (let i = 0; i < 1000; i++) {
      const next = job.nextRun(current);
      if (!next || next >= before) {
        break;
      }
      lastRun = next;
      current = new Date(next.getTime() + 1000); // advance 1 second past this run
    }

    return lastRun;
  } catch (error) {
    logger.error("Error computing previous cron run:", {
      cronExpression,
      error: error.message,
    });
    return null;
  }
}

/**
 * Determine whether a scheduled intent is due for execution.
 *
 * An intent is "due" if:
 * 1. It has a valid `last_evaluated_at` timestamp, AND
 * 2. There is a cron trigger point between `last_evaluated_at` and `now`
 *    (i.e. `nextRun(lastEvaluatedAt) <= now`).
 *
 * The `last_evaluated_at` field MUST be set at intent creation time (to
 * `created_at`) so that new intents wait for their first cron point rather
 * than firing immediately. And it MUST be updated to the cron trigger time
 * (not wall-clock time) after execution, so the same cron point never
 * triggers twice.
 *
 * @param {Object} intent - Intent object with schedule_type, schedule_cron, last_evaluated_at
 * @returns {{ isDue: boolean, nextRun: Date|null, triggerTime: Date|null, reason?: string }}
 */
function isIntentDue(intent) {
  // Immediate intents are never "due" on a schedule — they are triggered by scan detection
  if (intent.schedule_type === "immediate") {
    return { isDue: false, nextRun: null, triggerTime: null, reason: "immediate schedule type" };
  }

  if (!intent.schedule_cron) {
    return { isDue: false, nextRun: null, triggerTime: null, reason: "no cron expression" };
  }

  const validation = validateCron(intent.schedule_cron);
  if (!validation.valid) {
    return {
      isDue: false,
      nextRun: null,
      triggerTime: null,
      reason: `invalid cron: ${validation.error}`,
    };
  }

  const now = new Date();
  const nextRun = getNextRun(intent.schedule_cron, now);

  // If the intent has never been evaluated (legacy data or migration edge case),
  // treat it as due so it doesn't get stuck forever. New intents should always
  // have last_evaluated_at set to created_at at creation time.
  if (!intent.last_evaluated_at) {
    logger.warn("Intent missing last_evaluated_at — treating as due (legacy/migration case)", {
      intentId: intent.id,
      intentName: intent.name,
    });
    return {
      isDue: true,
      nextRun,
      triggerTime: now,
      reason: "missing last_evaluated_at (legacy)",
    };
  }

  const lastEval = new Date(intent.last_evaluated_at);

  // Find the next cron trigger after last evaluation
  const job = new Cron(intent.schedule_cron, { paused: true });
  const nextAfterLastEval = job.nextRun(lastEval);

  logger.debug("isIntentDue: evaluating", {
    intentId: intent.id,
    scheduleCron: intent.schedule_cron,
    now: now.toISOString(),
    lastEvaluatedAt: lastEval.toISOString(),
    nextAfterLastEval: nextAfterLastEval ? nextAfterLastEval.toISOString() : null,
    nextRun: nextRun ? nextRun.toISOString() : null,
  });

  // A cron trigger point exists between lastEval and now — intent is due.
  // Return the trigger time so the executor can record it as the new lastEvaluatedAt.
  if (nextAfterLastEval && nextAfterLastEval <= now) {
    return {
      isDue: true,
      nextRun,
      triggerTime: nextAfterLastEval,
      reason: `cron triggered at ${nextAfterLastEval.toISOString()}`,
    };
  }

  return { isDue: false, nextRun, triggerTime: null, reason: "not yet due" };
}

/**
 * Get a human-readable description of a cron expression.
 * @param {string} cronExpression - Cron expression
 * @returns {string} - Description
 */
function describeCron(cronExpression) {
  try {
    const nextRun = getNextRun(cronExpression);
    if (nextRun) {
      return `Next run: ${nextRun.toISOString()}`;
    }
    return "No upcoming runs";
  } catch {
    return "Invalid cron expression";
  }
}

module.exports = {
  validateCron,
  getNextRun,
  getPreviousRun,
  isIntentDue,
  describeCron,
};

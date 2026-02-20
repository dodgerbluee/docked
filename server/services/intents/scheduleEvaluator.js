/**
 * Intent Schedule Evaluator
 *
 * Evaluates cron-based schedules for intents using the croner library.
 * Determines whether a scheduled intent is due for execution based on
 * its cron expression and last evaluation timestamp.
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
 * An intent is "due" if there is at least one cron trigger point between
 * `lastEvaluatedAt` and `now`. This means the cron window has passed and
 * we should execute the intent.
 *
 * @param {Object} intent - Intent object with schedule_type, schedule_cron, last_evaluated_at
 * @returns {{ isDue: boolean, nextRun: Date|null, reason?: string }}
 */
function isIntentDue(intent) {
  // Immediate intents are never "due" on a schedule — they are triggered by scan detection
  if (intent.schedule_type === "immediate") {
    return { isDue: false, nextRun: null, reason: "immediate schedule type" };
  }

  if (!intent.schedule_cron) {
    return { isDue: false, nextRun: null, reason: "no cron expression" };
  }

  const validation = validateCron(intent.schedule_cron);
  if (!validation.valid) {
    return { isDue: false, nextRun: null, reason: `invalid cron: ${validation.error}` };
  }

  const now = new Date();
  const nextRun = getNextRun(intent.schedule_cron, now);

  // If the intent has never been evaluated, it's due immediately
  if (!intent.last_evaluated_at) {
    return { isDue: true, nextRun, reason: "never evaluated" };
  }

  const lastEval = new Date(intent.last_evaluated_at);

  // Find the most recent cron trigger between lastEvaluatedAt and now
  // If there's a trigger point in that window, the intent is due
  const job = new Cron(intent.schedule_cron, { paused: true });
  const nextAfterLastEval = job.nextRun(lastEval);

  if (nextAfterLastEval && nextAfterLastEval <= now) {
    return {
      isDue: true,
      nextRun,
      reason: `cron triggered at ${nextAfterLastEval.toISOString()}`,
    };
  }

  return { isDue: false, nextRun, reason: "not yet due" };
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

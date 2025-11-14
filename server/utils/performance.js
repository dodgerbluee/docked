/**
 * Performance Utilities
 * Provides performance monitoring and optimization helpers
 */

const logger = require('./logger');

/**
 * Measure execution time of an async function
 * @param {Function} fn - Async function to measure
 * @param {string} operationName - Name of the operation for logging
 * @param {Object} context - Additional context for logging
 * @returns {Promise<any>} - Result of the function
 */
async function measurePerformance(fn, operationName, context = {}) {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    if (duration > 1000) {
      // Log slow operations
      logger.warn(`Slow operation detected: ${operationName}`, {
        module: 'performance',
        operation: operationName,
        duration: `${duration}ms`,
        ...context,
      });
    } else if (logger.isDebugEnabled()) {
      logger.debug(`Operation completed: ${operationName}`, {
        module: 'performance',
        operation: operationName,
        duration: `${duration}ms`,
        ...context,
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Operation failed: ${operationName}`, {
      module: 'performance',
      operation: operationName,
      duration: `${duration}ms`,
      error: error.message,
      ...context,
    });
    throw error;
  }
}

/**
 * Batch operations with concurrency limit
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} concurrency - Maximum concurrent operations
 * @returns {Promise<Array>} - Results array
 */
async function batchProcess(items, processor, concurrency = 5) {
  const results = [];
  const errors = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, index) => {
      try {
        const result = await processor(item);
        return { success: true, result, index: i + index };
      } catch (error) {
        return { success: false, error, index: i + index };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((settled, idx) => {
      if (settled.status === 'fulfilled') {
        const { success, result, error, index } = settled.value;
        if (success) {
          results[index] = result;
        } else {
          errors.push({ index, error });
        }
      } else {
        errors.push({ index: i + idx, error: settled.reason });
      }
    });
  }

  if (errors.length > 0) {
    logger.warn(`Batch processing completed with ${errors.length} errors`, {
      module: 'performance',
      total: items.length,
      successful: results.length,
      errors: errors.length,
    });
  }

  return results;
}

/**
 * Debounce function calls
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function calls
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} - Throttled function
 */
function throttle(fn, limit) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * Retry with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>} - Result of the function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.debug(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          module: 'performance',
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: error.message,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  measurePerformance,
  batchProcess,
  debounce,
  throttle,
  retryWithBackoff,
};


const { logger } = require('./logger');

/**
 * Retries an async function with exponential backoff.
 * @param {Function} fn - Async function to execute
 * @param {object} opts
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.baseDelay=1000] - Base delay in ms
 * @param {string} [opts.label='operation'] - Label for log messages
 * @returns {Promise<*>}
 */
async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err?.status === 429 || err?.code === 'rate_limited';
      const isRetryable = isRateLimit || err?.status >= 500;

      if (attempt < maxRetries && isRetryable) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
          error: err.message,
          status: err.status,
        });
        await sleep(delay);
      } else {
        break;
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry };

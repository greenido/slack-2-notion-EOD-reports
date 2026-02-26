const TOKEN_PATTERNS = [
  /xoxb-[A-Za-z0-9-]+/g,
  /xoxp-[A-Za-z0-9-]+/g,
  /secret_[A-Za-z0-9-]+/g,
  /ntn_[A-Za-z0-9-]+/g,
];

function redact(value) {
  if (typeof value !== 'string') return value;
  let result = value;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function redactObject(obj) {
  if (typeof obj === 'string') return redact(obj);
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) return obj.map(redactObject);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    cleaned[key] = redactObject(value);
  }
  return cleaned;
}

function formatLog(level, message, meta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: redact(message),
  };
  if (meta && Object.keys(meta).length > 0) {
    entry.meta = redactObject(meta);
  }
  return JSON.stringify(entry);
}

const logger = {
  info(message, meta = {}) {
    console.log(formatLog('info', message, meta));
  },
  warn(message, meta = {}) {
    console.warn(formatLog('warn', message, meta));
  },
  error(message, meta = {}) {
    console.error(formatLog('error', message, meta));
  },
};

module.exports = { logger };

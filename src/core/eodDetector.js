/**
 * Configurable keyword patterns for EOD detection (case-insensitive).
 * Extend this array to broaden detection without changing logic.
 */
const EOD_KEYWORDS = [
  /\beod\b/i,
  /end\s+of\s+day/i,
  /daily\s+report/i,
  /daily\s+status/i,
  /today'?s?\s+update/i,
];

const MIN_STRUCTURED_LINES = 3;

/**
 * Determines whether a Slack message is an EOD root message.
 * A root message is one that is NOT a threaded reply and matches
 * at least one content heuristic.
 */
function isEODRootMessage(message) {
  if (!message || !message.ts) return false;

  // Must be a root message, not a reply
  if (message.thread_ts && message.thread_ts !== message.ts) return false;

  // Ignore bot messages and system messages
  if (message.subtype === 'bot_message' || message.bot_id) return false;

  const text = message.text || '';

  // Keyword match
  if (EOD_KEYWORDS.some((pattern) => pattern.test(text))) return true;

  // Structured summary heuristic: 3+ non-empty lines
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= MIN_STRUCTURED_LINES) return true;

  return false;
}

module.exports = { isEODRootMessage, EOD_KEYWORDS, MIN_STRUCTURED_LINES };

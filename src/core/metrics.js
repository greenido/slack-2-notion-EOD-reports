/**
 * Compute analytics metrics for an EOD thread.
 */

/**
 * Returns the ISO 8601 week number for a Date.
 * Week 1 is the week containing the first Thursday of the year.
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return weekNo;
}

/**
 * Format ISO week as "YYYY-Www" (e.g. "2026-W09").
 */
function formatISOWeek(date) {
  const week = getISOWeek(date);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Count words in a string (split on whitespace, filter empty).
 */
function countWords(text) {
  if (!text) return 0;
  return text
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Compute metrics for an EOD root message and its replies.
 * @param {object} rootMessage - Slack root message
 * @param {object[]} replies - Thread reply messages
 * @returns {{ wordCount: number, threadCount: number, isoWeek: string }}
 */
function computeMetrics(rootMessage, replies) {
  let totalWords = countWords(rootMessage.text);
  for (const reply of replies) {
    totalWords += countWords(reply.text);
  }

  const rootDate = new Date(parseFloat(rootMessage.ts) * 1000);

  return {
    wordCount: totalWords,
    threadCount: replies.length,
    isoWeek: formatISOWeek(rootDate),
  };
}

module.exports = { computeMetrics, getISOWeek, formatISOWeek, countWords };

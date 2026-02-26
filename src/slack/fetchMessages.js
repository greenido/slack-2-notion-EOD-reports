const { slackClient } = require('./client');
const { logger } = require('../utils/logger');

/**
 * Fetch all messages from a channel newer than oldestTs, paginated.
 * Returns messages in chronological order (oldest first).
 */
async function fetchChannelMessages(channelId, oldestTs = '0') {
  const allMessages = [];
  let cursor;

  do {
    const response = await slackClient.conversations.history({
      channel: channelId,
      oldest: oldestTs,
      limit: 200,
      cursor,
    });

    if (response.messages) {
      allMessages.push(...response.messages);
    }

    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  // Slack returns newest-first; reverse to chronological
  allMessages.reverse();

  logger.info('Fetched channel messages', { channelId, count: allMessages.length });
  return allMessages;
}

module.exports = { fetchChannelMessages };

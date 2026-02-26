const { slackClient } = require('./client');
const { logger } = require('../utils/logger');

/**
 * Fetch all replies in a thread. Returns messages in chronological order.
 * The first element is the root message.
 */
async function fetchThread(channelId, threadTs) {
  const allMessages = [];
  let cursor;

  do {
    const response = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
      cursor,
    });

    if (response.messages) {
      allMessages.push(...response.messages);
    }

    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  logger.info('Fetched thread', { channelId, threadTs, replyCount: allMessages.length - 1 });
  return allMessages;
}

module.exports = { fetchThread };

const { WebClient } = require('@slack/web-api');
const { logger } = require('../utils/logger');

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// In-memory caches (populated during a single run)
const userCache = new Map();
const channelNameCache = new Map();

async function validateSlackAccess() {
  const result = await slackClient.auth.test();
  logger.info('Slack auth validated', { bot: result.user, team: result.team });
  return result;
}

async function resolveChannelName(channelId) {
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId);

  try {
    const { channel } = await slackClient.conversations.info({ channel: channelId });
    const name = channel.name || channelId;
    channelNameCache.set(channelId, name);
    return name;
  } catch (err) {
    logger.warn('Failed to resolve channel name', { channelId, error: err.message });
    channelNameCache.set(channelId, channelId);
    return channelId;
  }
}

async function ensureBotInChannel(channelId, channelName) {
  try {
    await slackClient.conversations.join({ channel: channelId });
    logger.info('Bot joined channel', { channel: `#${channelName}`, channelId });
  } catch (err) {
    const slackError = err.data?.error;
    if (slackError === 'already_in_channel') {
      logger.info('Bot already in channel', { channel: `#${channelName}`, channelId });
      return;
    }
    if (slackError === 'missing_scope') {
      logger.warn(
        'Bot lacks "channels:join" scope — please invite it manually: /invite @bot in the channel, or add the scope in Slack app settings',
        { channel: `#${channelName}`, channelId },
      );
      return;
    }
    if (slackError === 'method_not_supported_for_channel_type') {
      logger.warn(
        'Cannot auto-join private channel — please invite the bot manually: /invite @bot',
        { channel: `#${channelName}`, channelId },
      );
      return;
    }
    throw err;
  }
}

async function resolveUser(userId) {
  if (userCache.has(userId)) return userCache.get(userId);

  try {
    const { user } = await slackClient.users.info({ user: userId });
    const displayName =
      user.profile?.display_name || user.profile?.real_name || user.name || userId;
    userCache.set(userId, displayName);
    return displayName;
  } catch (err) {
    logger.warn('Failed to resolve Slack user', { userId, error: err.message });
    userCache.set(userId, userId);
    return userId;
  }
}

function getUserCache() {
  return userCache;
}

module.exports = { slackClient, validateSlackAccess, resolveUser, getUserCache, resolveChannelName, ensureBotInChannel };

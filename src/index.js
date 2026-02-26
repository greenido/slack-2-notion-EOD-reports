const { logger } = require('./utils/logger');
const { validateSlackAccess, resolveUser, getUserCache, resolveChannelName, ensureBotInChannel } = require('./slack/client');
const { fetchChannelMessages } = require('./slack/fetchMessages');
const { fetchThread } = require('./slack/fetchThread');
const { validateNotionAccess } = require('./notion/client');
const { upsertEOD } = require('./notion/upsertPage');
const { isEODRootMessage } = require('./core/eodDetector');
const { transformThreadToNotionBlocks, extractAttachmentUrls, flattenThreadText, slackTsToDate } = require('./core/transformer');
const { computeMetrics } = require('./core/metrics');
const { loadState, saveState, getChannelCheckpoint, setChannelCheckpoint } = require('./state/stateManager');

const REQUIRED_ENV = ['SLACK_BOT_TOKEN', 'NOTION_API_KEY', 'NOTION_DATABASE_ID', 'SLACK_CHANNELS'];

const DEFAULT_HISTORY_HOURS = 48;

function getHistoryHours() {
  const raw = process.env.HISTORY_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_HISTORY_HOURS;
  const parsed = Number(raw);
  if (isNaN(parsed) || parsed < 0) return DEFAULT_HISTORY_HOURS;
  return parsed;
}

/**
 * Returns a Slack timestamp string representing `hours` hours ago,
 * or '0' when hours is 0 (meaning unlimited / full history).
 */
function getLookbackFloor(hours) {
  if (hours === 0) return '0';
  const floorEpoch = (Date.now() - hours * 60 * 60 * 1000) / 1000;
  return floorEpoch.toFixed(6);
}

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function buildSlackMessageUrl(teamDomain, channelId, ts) {
  const tsClean = ts.replace('.', '');
  return `https://slack.com/archives/${channelId}/p${tsClean}`;
}

/**
 * Process a single EOD root message: fetch thread, transform, upsert.
 */
async function processEOD(rootMessage, channelId, channelName, databaseId) {
  const userCache = getUserCache();

  // Resolve root message author
  const developer = await resolveUser(rootMessage.user);

  // Fetch thread if the root has replies
  let replies = [];
  if (rootMessage.reply_count && rootMessage.reply_count > 0) {
    const thread = await fetchThread(channelId, rootMessage.ts);
    // First message in thread is the root; rest are replies
    replies = thread.slice(1);
  }

  // Pre-resolve all reply authors
  for (const reply of replies) {
    if (reply.user) await resolveUser(reply.user);
  }

  // Compute metrics
  const metrics = computeMetrics(rootMessage, replies);

  // Build Notion blocks
  const blocks = transformThreadToNotionBlocks(rootMessage, replies, userCache);

  // Collect all attachment URLs
  const allAttachments = [
    ...extractAttachmentUrls(rootMessage),
    ...replies.flatMap(extractAttachmentUrls),
  ];

  // Root message date
  const rootDate = slackTsToDate(rootMessage.ts);
  const dateStr = rootDate.toISOString().split('T')[0];

  // Title: "EOD - Developer - 2026-02-26"
  const title = `EOD - ${developer} - ${dateStr}`;

  const eodData = {
    title,
    developer,
    slackUserId: rootMessage.user || '',
    channelName,
    date: rootDate.toISOString(),
    slackMessageUrl: buildSlackMessageUrl('', channelId, rootMessage.ts),
    slackTs: rootMessage.ts,
    lastEditedTs: rootMessage.edited?.ts || '',
    rawText: flattenThreadText(rootMessage, replies, userCache),
    attachmentUrl: allAttachments[0] || null,
    threadCount: metrics.threadCount,
    wordCount: metrics.wordCount,
    isoWeek: metrics.isoWeek,
  };

  await upsertEOD(databaseId, eodData, blocks);
  return title;
}

/**
 * Process all EOD messages from a single channel.
 * Returns the latest ts processed (or null if nothing processed).
 */
async function processChannel(channelId, channelName, checkpoint, databaseId) {
  const messages = await fetchChannelMessages(channelId, checkpoint);

  const eodMessages = messages.filter(isEODRootMessage);
  logger.info('Channel scan complete', {
    channel: `#${channelName}`,
    channelId,
    messagesScanned: messages.length,
    eodReportsFound: eodMessages.length,
    checkpoint: checkpoint === '0' ? 'beginning' : checkpoint,
  });

  if (eodMessages.length === 0) {
    logger.info('No new EOD reports to process', { channel: `#${channelName}` });
    return null;
  }

  let latestTs = checkpoint;
  let sentCount = 0;

  for (const msg of eodMessages) {
    try {
      const title = await processEOD(msg, channelId, channelName, databaseId);
      sentCount++;
      logger.info('Sent EOD report to Notion', {
        channel: `#${channelName}`,
        title,
        slackTs: msg.ts,
      });

      if (msg.ts > latestTs) {
        latestTs = msg.ts;
      }
    } catch (err) {
      logger.error('Failed to process EOD message', {
        channel: `#${channelName}`,
        channelId,
        ts: msg.ts,
        error: err.message,
      });
    }
  }

  logger.info('Channel processing summary', {
    channel: `#${channelName}`,
    eodFound: eodMessages.length,
    sentToNotion: sentCount,
    failed: eodMessages.length - sentCount,
  });

  return latestTs;
}

async function main() {
  try {
    // Validate configuration
    validateEnv();

    const databaseId = process.env.NOTION_DATABASE_ID;
    const channels = process.env.SLACK_CHANNELS.split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    logger.info('Starting EOD sync', { channels, databaseId });

    // Validate external access
    await validateSlackAccess();
    await validateNotionAccess(databaseId);

    // Load persisted state
    const state = loadState();

    // Resolve channel names and ensure bot membership
    const channelInfo = [];
    for (const channelId of channels) {
      const channelName = await resolveChannelName(channelId);
      try {
        await ensureBotInChannel(channelId, channelName);
      } catch (err) {
        logger.error('Cannot join channel', {
          channel: `#${channelName}`,
          channelId,
          error: err.message,
        });
      }
      channelInfo.push({ channelId, channelName });
    }

    const historyHours = getHistoryHours();
    const lookbackFloor = getLookbackFloor(historyHours);

    logger.info('Channels to process', {
      channels: channelInfo.map((c) => `#${c.channelName} (${c.channelId})`),
      historyHours: historyHours === 0 ? 'unlimited' : historyHours,
    });

    // Process each channel independently
    let totalProcessed = 0;

    for (const { channelId, channelName } of channelInfo) {
      const savedCheckpoint = getChannelCheckpoint(state, channelId);
      const checkpoint = savedCheckpoint > lookbackFloor ? savedCheckpoint : lookbackFloor;

      logger.info('Processing channel', {
        channel: `#${channelName}`,
        channelId,
        savedCheckpoint: savedCheckpoint === '0' ? 'none' : savedCheckpoint,
        effectiveCheckpoint: checkpoint === '0' ? 'beginning' : checkpoint,
        lookbackHours: historyHours === 0 ? 'unlimited' : historyHours,
      });

      try {
        const latestTs = await processChannel(channelId, channelName, checkpoint, databaseId);

        if (latestTs && latestTs > checkpoint) {
          setChannelCheckpoint(state, channelId, latestTs);
          totalProcessed++;
        }
      } catch (err) {
        logger.error('Channel processing failed, continuing with others', {
          channel: `#${channelName}`,
          channelId,
          error: err.message,
        });
      }
    }

    // Persist state only after all channels attempted
    saveState(state);

    logger.info('EOD sync complete', {
      channelsProcessed: totalProcessed,
      totalChannels: channelInfo.length,
    });
    process.exit(0);
  } catch (err) {
    logger.error('Fatal error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

main();

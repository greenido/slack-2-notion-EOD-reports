const { notionClient } = require('./client');
const { withRetry } = require('../utils/retry');
const { logger } = require('../utils/logger');

/**
 * Query Notion DB for an existing page by Slack TS.
 * Returns the page object or null.
 */
async function findPageBySlackTs(databaseId, slackTs) {
  const response = await withRetry(
    () =>
      notionClient.databases.query({
        database_id: databaseId,
        filter: {
          property: 'Slack TS',
          rich_text: { equals: slackTs },
        },
        page_size: 1,
      }),
    { label: 'notion-query-by-ts' }
  );
  return response.results[0] || null;
}

/**
 * Build the Notion page properties object from EOD data.
 */
function buildProperties(eodData) {
  const props = {
    Title: {
      title: [{ text: { content: eodData.title } }],
    },
    Developer: {
      select: { name: eodData.developer },
    },
    'Slack User ID': {
      rich_text: [{ text: { content: eodData.slackUserId } }],
    },
    Channel: {
      select: { name: eodData.channelName },
    },
    Date: {
      date: { start: eodData.date },
    },
    'Slack Message URL': {
      url: eodData.slackMessageUrl,
    },
    'Slack TS': {
      rich_text: [{ text: { content: eodData.slackTs } }],
    },
    'Last Edited TS': {
      rich_text: [{ text: { content: eodData.lastEditedTs || '' } }],
    },
    'Raw Text': {
      rich_text: [{ text: { content: truncate(eodData.rawText, 2000) } }],
    },
    'Imported At': {
      date: { start: new Date().toISOString() },
    },
    'Thread Count': {
      number: eodData.threadCount,
    },
    'Word Count': {
      number: eodData.wordCount,
    },
    Week: {
      rich_text: [{ text: { content: eodData.isoWeek } }],
    },
  };

  if (eodData.attachmentUrl) {
    props['Attachments'] = { url: eodData.attachmentUrl };
  }

  return props;
}

/**
 * Create a new Notion page for an EOD.
 */
async function createPage(databaseId, eodData, blocks) {
  const response = await withRetry(
    () =>
      notionClient.pages.create({
        parent: { database_id: databaseId },
        properties: buildProperties(eodData),
        children: blocks,
      }),
    { label: 'notion-create-page' }
  );
  logger.info('Created Notion page', { title: eodData.title, pageId: response.id });
  return response;
}

/**
 * Update an existing Notion page: properties + replace content blocks.
 */
async function updatePage(pageId, eodData, blocks) {
  // Update properties
  await withRetry(
    () =>
      notionClient.pages.update({
        page_id: pageId,
        properties: buildProperties(eodData),
      }),
    { label: 'notion-update-props' }
  );

  // Remove existing child blocks
  const existingBlocks = await withRetry(
    () => notionClient.blocks.children.list({ block_id: pageId, page_size: 100 }),
    { label: 'notion-list-blocks' }
  );

  for (const block of existingBlocks.results) {
    await withRetry(
      () => notionClient.blocks.delete({ block_id: block.id }),
      { label: 'notion-delete-block' }
    );
  }

  // Append new blocks (batch in groups of 100)
  for (let i = 0; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    await withRetry(
      () =>
        notionClient.blocks.children.append({
          block_id: pageId,
          children: batch,
        }),
      { label: 'notion-append-blocks' }
    );
  }

  logger.info('Updated Notion page', { title: eodData.title, pageId });
}

/**
 * Upsert an EOD into Notion.
 * - If no page with this Slack TS exists → create
 * - If page exists and Slack edited timestamp is newer → update
 * - Otherwise → skip
 */
async function upsertEOD(databaseId, eodData, blocks) {
  const existing = await findPageBySlackTs(databaseId, eodData.slackTs);

  if (!existing) {
    return createPage(databaseId, eodData, blocks);
  }

  // Check if the Slack message was edited since last sync
  const storedEditedTs =
    existing.properties['Last Edited TS']?.rich_text?.[0]?.plain_text || '';

  if (eodData.lastEditedTs && eodData.lastEditedTs > storedEditedTs) {
    return updatePage(existing.id, eodData, blocks);
  }

  logger.info('Skipping unchanged EOD', { title: eodData.title, slackTs: eodData.slackTs });
  return null;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

module.exports = { upsertEOD, findPageBySlackTs };

const { Client } = require('@notionhq/client');
const { logger } = require('../utils/logger');

const notionClient = new Client({ auth: process.env.NOTION_API_KEY });

async function validateNotionAccess(databaseId) {
  const response = await notionClient.databases.query({
    database_id: databaseId,
    page_size: 1,
  });
  logger.info('Notion DB access validated', { databaseId, hasResults: response.results.length > 0 });
  return response;
}

module.exports = { notionClient, validateNotionAccess };

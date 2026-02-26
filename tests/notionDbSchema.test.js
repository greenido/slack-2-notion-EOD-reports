/**
 * Integration test — validates that the target Notion database
 * contains every property the sync pipeline expects, with the
 * correct Notion property type.
 *
 * Run:  npm test
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { Client } = require('@notionhq/client');

const EXPECTED_PROPERTIES = {
  Title:              'title',
  Developer:          'select',
  'Slack User ID':    'rich_text',
  Channel:            'select',
  Date:               'date',
  'Slack Message URL':'url',
  'Slack TS':         'rich_text',
  'Last Edited TS':   'rich_text',
  'Raw Text':         'rich_text',
  'Imported At':      'date',
  'Thread Count':     'number',
  'Word Count':       'number',
  Week:               'rich_text',
  Attachments:        'url',
};

describe('Notion database schema', () => {
  let dbProperties;

  it('should retrieve the database schema', async () => {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const databaseId = process.env.NOTION_DATABASE_ID;

    assert.ok(process.env.NOTION_API_KEY, 'NOTION_API_KEY must be set');
    assert.ok(databaseId, 'NOTION_DATABASE_ID must be set');

    const db = await notion.databases.retrieve({ database_id: databaseId });
    dbProperties = db.properties;

    assert.ok(dbProperties, 'Database should have a properties object');
  });

  for (const [name, expectedType] of Object.entries(EXPECTED_PROPERTIES)) {
    it(`should have property "${name}" of type "${expectedType}"`, () => {
      assert.ok(dbProperties, 'Database properties not loaded — previous test may have failed');

      const prop = dbProperties[name];
      assert.ok(prop, `Missing property: "${name}"`);
      assert.equal(
        prop.type,
        expectedType,
        `Property "${name}" should be "${expectedType}" but is "${prop.type}"`,
      );
    });
  }
});

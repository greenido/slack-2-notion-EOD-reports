/**
 * Transforms a Slack thread (root + replies) into Notion block objects.
 *
 * Handles: bold, italic, strikethrough, inline code, code blocks,
 * bulleted lists, user mentions, and URLs.
 */

const MENTION_RE = /<@([A-Z0-9]+)>/g;
const URL_RE = /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g;
const CODE_BLOCK_RE = /```([\s\S]*?)```/g;

// --- Rich-text helpers ---

function slackTsToDate(ts) {
  return new Date(parseFloat(ts) * 1000);
}

function formatTimestamp(ts) {
  return slackTsToDate(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Resolve `<@U123>` mentions and `<url|label>` links in raw text,
 * returning the cleaned string.
 */
function resolveSlackEntities(text, userCache) {
  let resolved = text.replace(MENTION_RE, (_match, userId) => {
    const name = userCache.get(userId) || userId;
    return `@${name}`;
  });
  resolved = resolved.replace(URL_RE, (_match, url, label) => label || url);
  return resolved;
}

/**
 * Parse a single line of Slack mrkdwn into an array of Notion rich_text objects.
 * Supports: *bold*, _italic_, ~strike~, `code`, and plain text.
 */
function parseInlineFormatting(text) {
  const segments = [];
  // Regex to tokenise inline formatting; order matters
  const TOKEN_RE = /(`[^`]+`|\*[^*]+\*|_[^_]+_|~[^~]+~)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    if (match.index > lastIndex) {
      segments.push(richText(text.slice(lastIndex, match.index)));
    }

    const raw = match[0];
    const inner = raw.slice(1, -1);

    if (raw.startsWith('`')) {
      segments.push(richText(inner, { code: true }));
    } else if (raw.startsWith('*')) {
      segments.push(richText(inner, { bold: true }));
    } else if (raw.startsWith('_')) {
      segments.push(richText(inner, { italic: true }));
    } else if (raw.startsWith('~')) {
      segments.push(richText(inner, { strikethrough: true }));
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push(richText(text.slice(lastIndex)));
  }

  return segments.length ? segments : [richText(text)];
}

function richText(content, annotations = {}) {
  // Detect if the content is a bare URL
  const urlMatch = content.match(/^(https?:\/\/\S+)$/);
  const obj = {
    type: 'text',
    text: { content, ...(urlMatch ? { link: { url: urlMatch[1] } } : {}) },
  };
  if (Object.keys(annotations).length) {
    obj.annotations = annotations;
  }
  return obj;
}

// --- Block builders ---

function paragraphBlock(richTextArray) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richTextArray } };
}

function codeBlock(code, language = 'plain text') {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: code.slice(0, 2000) } }],
      language,
    },
  };
}

function bulletBlock(richTextArray) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richTextArray },
  };
}

function dividerBlock() {
  return { object: 'block', type: 'divider', divider: {} };
}

function headingBlock(text, level = 3) {
  const key = `heading_${level}`;
  return {
    object: 'block',
    type: key,
    [key]: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

// --- Main transformer ---

/**
 * Convert a single Slack message body into Notion blocks.
 * Handles code blocks, bullet lists, and paragraphs.
 */
function messageToBlocks(text, userCache) {
  if (!text) return [];

  const resolved = resolveSlackEntities(text, userCache);
  const blocks = [];

  // Split around code fences
  const parts = resolved.split(CODE_BLOCK_RE);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Inside a code fence
      blocks.push(codeBlock(parts[i].trim()));
      continue;
    }

    const segment = parts[i];
    const lines = segment.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Bullet list (- or *)
      const bulletMatch = trimmed.match(/^[-*•]\s+(.*)/);
      if (bulletMatch) {
        blocks.push(bulletBlock(parseInlineFormatting(bulletMatch[1])));
      } else {
        blocks.push(paragraphBlock(parseInlineFormatting(trimmed)));
      }
    }
  }

  return blocks;
}

/**
 * Transform an entire Slack thread into Notion blocks.
 * @param {object} rootMessage - The root Slack message
 * @param {object[]} replies - Thread replies (excluding root)
 * @param {Map} userCache - userId → display name cache
 * @returns {object[]} Array of Notion block objects
 */
function transformThreadToNotionBlocks(rootMessage, replies, userCache) {
  const blocks = [];

  // Root message content
  blocks.push(...messageToBlocks(rootMessage.text, userCache));

  // Attachments section for root
  const rootAttachments = extractAttachmentUrls(rootMessage);
  if (rootAttachments.length) {
    blocks.push(dividerBlock());
    blocks.push(headingBlock('Attachments'));
    for (const url of rootAttachments) {
      blocks.push(paragraphBlock([richText(url, {})]));
    }
  }

  if (replies.length > 0) {
    blocks.push(dividerBlock());
    blocks.push(headingBlock('Thread Replies'));

    for (const reply of replies) {
      const author = userCache.get(reply.user) || reply.user || 'Unknown';
      const time = formatTimestamp(reply.ts);
      blocks.push(
        paragraphBlock([richText(`${author} — ${time}`, { bold: true })])
      );
      blocks.push(...messageToBlocks(reply.text, userCache));

      const replyAttachments = extractAttachmentUrls(reply);
      for (const url of replyAttachments) {
        blocks.push(paragraphBlock([richText(url)]));
      }
    }
  }

  // Notion API limits to 100 blocks per request
  return blocks.slice(0, 100);
}

/**
 * Extract public URLs from Slack message files and attachments.
 */
function extractAttachmentUrls(message) {
  const urls = [];
  if (message.files) {
    for (const file of message.files) {
      const url = file.url_private || file.permalink_public || file.permalink;
      if (url) urls.push(url);
    }
  }
  if (message.attachments) {
    for (const att of message.attachments) {
      if (att.original_url) urls.push(att.original_url);
      else if (att.from_url) urls.push(att.from_url);
    }
  }
  return urls;
}

/**
 * Flatten thread text for the Raw Text property.
 */
function flattenThreadText(rootMessage, replies, userCache) {
  const parts = [resolveSlackEntities(rootMessage.text || '', userCache)];
  for (const reply of replies) {
    const author = userCache.get(reply.user) || reply.user || 'Unknown';
    parts.push(`[${author}] ${resolveSlackEntities(reply.text || '', userCache)}`);
  }
  return parts.join('\n---\n');
}

module.exports = {
  transformThreadToNotionBlocks,
  extractAttachmentUrls,
  flattenThreadText,
  resolveSlackEntities,
  slackTsToDate,
};

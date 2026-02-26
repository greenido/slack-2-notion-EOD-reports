const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const STATE_PATH = path.resolve(process.cwd(), 'state.json');

const DEFAULT_STATE = { channels: {} };

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      logger.info('No state.json found, starting fresh');
      return structuredClone(DEFAULT_STATE);
    }
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const state = JSON.parse(raw);
    logger.info('State loaded', { channels: Object.keys(state.channels || {}) });
    return { channels: {}, ...state };
  } catch (err) {
    logger.warn('Failed to parse state.json, starting fresh', { error: err.message });
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(state) {
  const json = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(STATE_PATH, json, 'utf-8');
  logger.info('State saved', { channels: Object.keys(state.channels || {}) });
}

function getChannelCheckpoint(state, channelId) {
  return state.channels[channelId]?.lastProcessedTs || '0';
}

function setChannelCheckpoint(state, channelId, ts) {
  if (!state.channels[channelId]) {
    state.channels[channelId] = {};
  }
  state.channels[channelId].lastProcessedTs = ts;
}

module.exports = { loadState, saveState, getChannelCheckpoint, setChannelCheckpoint };

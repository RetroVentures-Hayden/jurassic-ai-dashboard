const path = require('node:path');
const os = require('node:os');

const APP_SLUG = 'jurassic-ai-dashboard';

const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  APP_SLUG
);

const STATE_DIR = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  APP_SLUG
);

const DB_PATH = path.join(CONFIG_DIR, 'jurassic.duckdb');
const LEGACY_SQLITE_DB_PATH = path.join(CONFIG_DIR, 'jurassic.sqlite3');
const IMAGES_DIR = path.join(CONFIG_DIR, 'images');
const LAST_SYNC_MARKER = path.join(STATE_DIR, 'last-sync-date');
const SYNC_LOG_FILE = path.join(STATE_DIR, 'sync.log');

module.exports = {
  APP_SLUG,
  CONFIG_DIR,
  STATE_DIR,
  DB_PATH,
  IMAGES_DIR,
  LAST_SYNC_MARKER,
  SYNC_LOG_FILE,
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
};

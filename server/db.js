const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH lets you point the database file at a persistent disk in production
// (e.g. /var/data/data.sqlite on Render). Without it, defaults to a local
// file next to this code, which is fine for local development but is wiped
// on every deploy/restart on platforms with an ephemeral filesystem.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS food_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,              -- YYYY-MM-DD, local day this entry counts toward
    name TEXT NOT NULL,
    calories INTEGER NOT NULL,
    confidence TEXT,
    note TEXT,
    image_thumb TEXT,               -- small base64 jpeg thumbnail, optional
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS whoop_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL      -- epoch ms
  );
`);

module.exports = db;

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// One local file holds all servers' data; every row is keyed by guild_id (the server)
const db = new DatabaseSync(path.join(__dirname, '..', 'data.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
    PRIMARY KEY (guild_id, key)
  );
  -- Channels followed for live alerts. platform: kick / twitch / youtube.
  -- channel_id: Kick slug, Twitch user ID, YouTube channel ID (UC...). last_live_id: the last stream alerted.
  CREATE TABLE IF NOT EXISTS live_channels (
    guild_id TEXT NOT NULL, platform TEXT NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL, last_live_id TEXT,
    PRIMARY KEY (guild_id, platform, channel_id)
  );
  CREATE TABLE IF NOT EXISTS levels (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  -- Recent messages, so edit/delete logs still know them after a restart (kept 7 days)
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL, author_name TEXT NOT NULL, content TEXT, attachments TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_created_at ON messages (created_at);
`);

// Before Twitch/YouTube, followed channels were in "kick_channels" (all Kick). Move them over once,
// all or nothing, keeping which stream was already alerted.
function migrateKickChannels(database) {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kick_channels'").get()) return;
  database.exec('BEGIN');
  try {
    database.exec(`
      INSERT OR IGNORE INTO live_channels (guild_id, platform, channel_id, name, last_live_id)
        SELECT guild_id, 'kick', slug, slug, CAST(last_live_id AS TEXT) FROM kick_channels;
      DROP TABLE kick_channels;
    `);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
migrateKickChannels(db);

function getSetting(guildId, key) {
  return db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key)?.value ?? null;
}

// Passing null deletes the setting
function setSetting(guildId, key, value) {
  if (value == null) return db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?').run(guildId, key);
  db.prepare(
    'INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT (guild_id, key) DO UPDATE SET value = excluded.value',
  ).run(guildId, key, String(value));
}

module.exports = { db, getSetting, setSetting, migrateKickChannels };

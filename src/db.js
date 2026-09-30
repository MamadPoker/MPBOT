const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// One local file holds all servers' data; every row is keyed by guild_id (the server)
const db = new DatabaseSync(path.join(__dirname, '..', 'data.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
    PRIMARY KEY (guild_id, key)
  );
  CREATE TABLE IF NOT EXISTS kick_channels (
    guild_id TEXT NOT NULL, slug TEXT NOT NULL, last_live_id INTEGER,
    PRIMARY KEY (guild_id, slug)
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

// A short-lived version of the bot (Twitch/YouTube alerts, since removed) moved the followed channels
// into a "live_channels" table. Move the Kick ones back once, all or nothing. last_live_id goes back to a
// number, so the stream that was already alerted isn't alerted again. Twitch/YouTube rows (if any) are
// kept there unused, not deleted; the table is removed once it's empty.
function moveLiveChannelsBack(database) {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'live_channels'").get()) return;
  database.exec('BEGIN');
  try {
    database.exec(`
      INSERT OR IGNORE INTO kick_channels (guild_id, slug, last_live_id)
        SELECT guild_id, channel_id, CAST(last_live_id AS INTEGER) FROM live_channels WHERE platform = 'kick';
      DELETE FROM live_channels WHERE platform = 'kick';
    `);
    if (!database.prepare('SELECT 1 FROM live_channels').get()) database.exec('DROP TABLE live_channels');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
moveLiveChannelsBack(db);

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

module.exports = { db, getSetting, setSetting, moveLiveChannelsBack };

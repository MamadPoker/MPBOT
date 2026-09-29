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
`);

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

module.exports = { db, getSetting, setSetting };

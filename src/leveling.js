const { db, getSetting } = require('./db');

// XP needed to go from `level` to the next one (same curve MEE6 uses: 100, 155, 220, ...)
const xpToNext = (level) => 5 * level ** 2 + 50 * level + 100;

// Total XP -> { level, xp earned inside this level, xp needed for the next level }
function levelInfo(totalXp) {
  let level = 0;
  let xp = totalXp;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
  }
  return { level, xp, needed: xpToNext(level) };
}

const COOLDOWN = 60_000; // XP at most once a minute, so spamming doesn't help
const lastGain = new Map(); // "server:user" -> time of last XP (forgotten on restart, that's fine)

// Leveling is off unless an admin runs /level enable
const levelingEnabled = (guildId) => Boolean(getSetting(guildId, 'leveling_enabled'));

async function giveXp(message) {
  if (!levelingEnabled(message.guild.id)) return;
  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() - (lastGain.get(key) ?? 0) < COOLDOWN) return;
  lastGain.set(key, Date.now());

  const gained = 15 + Math.floor(Math.random() * 11); // 15-25 XP
  const { xp } = db.prepare(`
    INSERT INTO levels (guild_id, user_id, xp) VALUES (?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = xp + excluded.xp
    RETURNING xp
  `).get(message.guild.id, message.author.id, gained);

  const { level } = levelInfo(xp);
  if (level > levelInfo(xp - gained).level) {
    await message.channel
      .send({ content: `🎉 ${message.author} reached **level ${level}**!`, allowedMentions: { users: [message.author.id] } })
      .catch(() => {});
  }
}

module.exports = { levelInfo, levelingEnabled, giveXp };

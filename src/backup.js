const fs = require('node:fs');
const path = require('node:path');
const { db, getSetting, setSetting } = require('./db');

// HOW TO RESTORE A BACKUP (if data.db is broken or lost):
//   1. pm2 stop mpbot
//   2. In the bot folder, rename data.db to data.db.broken (and delete data.db-journal if there is one)
//   3. Copy a backup from backups/ (or the file from your Discord DMs) into the bot folder and name it data.db
//   4. pm2 start mpbot

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const KEEP = 7;
const BACKUP_HOUR = 4; // 4 AM, laptop time
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DM_EVERY = 7 * DAY - HOUR; // weekly (an hour of slack so it doesn't slip to the 8th night)
const BOT = '_bot'; // settings row for bot-wide values (not tied to a server)

const pad = (n) => String(n).padStart(2, '0');

// Backups, newest first
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^data-.+\.db$/.test(name))
    .map((name) => ({ name, file: path.join(BACKUP_DIR, name), time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
}

// Safe copy while the bot is running: VACUUM INTO writes one consistent snapshot (a plain file copy could
// catch the database halfway through a write). Then only the newest 7 backups are kept.
function makeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const d = new Date();
  const name = `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.db`;
  const file = path.join(BACKUP_DIR, name);
  fs.rmSync(file, { force: true }); // two backups in the same second: keep the newer one
  db.prepare('VACUUM INTO ?').run(file);
  for (const old of listBackups().slice(KEEP)) fs.rmSync(old.file);
  return file;
}

async function sendBackupToOwner(client, file) {
  if (!process.env.OWNER_ID) throw new Error('OWNER_ID is not set in .env');
  const owner = await client.users.fetch(process.env.OWNER_ID);
  await owner.send({ content: `🗄️ MP Bot database backup (\`${path.basename(file)}\`). Keep it somewhere safe.`, files: [file] });
}

async function nightlyBackup(client) {
  const file = makeBackup();
  console.log(`Backup saved: backups/${path.basename(file)}`);
  // Once a week, also DM it to the owner, so there's a copy outside the laptop (if it fails, retry next night)
  if (Date.now() - Number(getSetting(BOT, 'backup_dm_at') ?? 0) >= DM_EVERY) {
    try {
      await sendBackupToOwner(client, file);
      setSetting(BOT, 'backup_dm_at', Date.now());
    } catch (err) {
      console.error(`Backup saved, but couldn't DM it to the owner: ${err.message}`);
    }
  }
}

// Time until the next `hour`:00 on the laptop's clock
function msUntilHour(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function startBackups(client) {
  const run = () => nightlyBackup(client).catch((err) => console.error('Backup failed:', err.message));
  // Laptop was off or asleep at 4 AM? Make the missed backup now.
  if (Date.now() - (listBackups()[0]?.time ?? 0) > DAY) run();
  const scheduleNext = () => setTimeout(() => {
    run();
    scheduleNext();
  }, msUntilHour(BACKUP_HOUR));
  scheduleNext();
}

module.exports = { BACKUP_DIR, listBackups, makeBackup, sendBackupToOwner, msUntilHour, startBackups };

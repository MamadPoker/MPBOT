const { Events, Status } = require('discord.js');
const { getSetting, setSetting } = require('./db');

// "I was offline" DMs to the owner. While connected, the bot saves a heartbeat time every minute.
// When it connects again, a gap since the last heartbeat = it was offline.

const BOT = '_bot'; // settings row for bot-wide values (not tied to a server)
const HEARTBEAT_EVERY = 60_000;
const MIN_GAP = 3 * 60_000; // shorter gaps (e.g. "pm2 restart" after git pull) aren't reported
const DM_EVERY = 10 * 60_000; // at most one DM per 10 minutes; offline periods in between are combined
const startedAt = Date.now();

const REASONS = {
  clean: 'I was stopped or restarted (for example `pm2 restart` or `pm2 stop`).',
  crash: 'I crashed. Check `pm2 logs mpbot` for the error.',
  watchdog: 'I lost the connection to Discord (internet/VPN problem), so the watchdog restarted me.',
  connection: 'I lost the connection to Discord (internet/VPN problem, or the laptop was asleep) and reconnected without restarting.',
  unknown: 'No clean shutdown was recorded, so the laptop was probably off or asleep, Windows restarted, or I was force-closed.',
};

const json = (key, fallback) => JSON.parse(getSetting(BOT, key) ?? JSON.stringify(fallback));

// Really connected: ready, and Discord answered a heartbeat recently (after sleep the old connection
// still says "ready" for a while, so the heartbeat age is what counts)
const isConnected = (client) =>
  client.isReady() && client.ws.shards.size > 0 &&
  client.ws.shards.every((s) => s.status === Status.Ready && Date.now() - s.lastPingTimestamp < 90_000);

// Called when the bot is about to stop. Keeps the FIRST reason after the last heartbeat
// (e.g. a VPN drop -> watchdog restart -> several failed logins: the watchdog is the real reason).
function recordShutdown(kind) {
  const previous = json('shutdown', null);
  if (previous && previous.at >= Number(getSetting(BOT, 'heartbeat_at') ?? 0)) return;
  setSetting(BOT, 'shutdown', JSON.stringify({ at: Date.now(), kind }));
}

// "1h 12m", "5m", "2d 3h"
function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  const [d, h, m] = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60];
  return (d ? [`${d}d`, h && `${h}h`] : h ? [`${h}h`, m && `${m}m`] : [`${m}m`]).filter(Boolean).join(' ');
}

// "14:05 to 15:17" in Istanbul time; with dates if it wasn't all on one day ("29 Sep 23:50 to 30 Sep 01:10")
const istanbul = (ms, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', ...options }).format(ms);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (ms) => istanbul(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = (ms) => `${istanbul(ms, { day: 'numeric' })} ${MONTHS[istanbul(ms, { month: 'numeric' }) - 1]}`;
function formatPeriod(from, to) {
  if (istanbul(from, { dateStyle: 'short' }) === istanbul(to, { dateStyle: 'short' })) return `${clock(from)} to ${clock(to)}`;
  return `${day(from)} ${clock(from)} to ${day(to)} ${clock(to)}`;
}

function offlineMessage(periods) {
  const describe = (p) => `${formatDuration(p.to - p.from)} (from ${formatPeriod(p.from, p.to)})`;
  if (periods.length === 1) return `⚠️ I was offline for ${describe(periods[0])}.\nReason: ${REASONS[periods[0].reason]}`;
  return [`⚠️ I was offline ${periods.length} times:`, ...periods.map((p) => `• ${describe(p)}: ${REASONS[p.reason]}`)].join('\n');
}

let flushTimer = null;
// Send waiting offline notices, at most one DM per 10 minutes (later ones wait and get combined)
async function flush(client) {
  const pending = json('offline_pending', []);
  if (!pending.length) return;
  const wait = Number(getSetting(BOT, 'offline_dm_at') ?? 0) + DM_EVERY - Date.now();
  if (wait > 0) {
    flushTimer ??= setTimeout(() => {
      flushTimer = null;
      flush(client);
    }, wait);
    return;
  }
  setSetting(BOT, 'offline_pending', null);
  const text = offlineMessage(pending);
  try {
    if (!process.env.OWNER_ID) throw new Error('OWNER_ID is not set in .env');
    const owner = await client.users.fetch(process.env.OWNER_ID);
    await owner.send(text);
    setSetting(BOT, 'offline_dm_at', Date.now());
  } catch (err) {
    console.error(`Couldn't DM the owner about being offline (${err.message}):\n${text}`);
  }
}

// Connected (at startup, or reconnected after a drop): was there a gap since the last heartbeat?
function onConnected(client) {
  const now = Date.now();
  const last = Number(getSetting(BOT, 'heartbeat_at') ?? 0);
  setSetting(BOT, 'heartbeat_at', now);
  if (last && now - last > MIN_GAP) {
    const shutdown = json('shutdown', null);
    const reason = last >= startedAt ? 'connection' // this same process wrote the last heartbeat: it never stopped
      : shutdown && shutdown.at >= last ? shutdown.kind
      : 'unknown';
    setSetting(BOT, 'offline_pending', JSON.stringify([...json('offline_pending', []), { from: last, to: now, reason }]));
  }
  setSetting(BOT, 'shutdown', null);
  return flush(client);
}

function startOfflineNotices(client) {
  const connected = () => onConnected(client).catch((err) => console.error('Offline notice error:', err.message));
  client.on(Events.ShardReady, connected);
  client.on(Events.ShardResume, connected);
  setInterval(() => {
    if (isConnected(client)) setSetting(BOT, 'heartbeat_at', Date.now());
  }, HEARTBEAT_EVERY);
}

module.exports = { startOfflineNotices, recordShutdown, formatDuration, formatPeriod, offlineMessage };

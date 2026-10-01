const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { db, getSetting } = require('./db');

// Every log type is named after its channel (same names as ProBot's LOGs category)
const LOG_TYPES = [
  'invite', 'join-server', 'left-server',
  'kick-logger', 'ban-logger', 'unban-logger', 'timeout-logger',
  'change-nickname-logger', 'give-role-logger',
  'create-role-logger', 'role_updated_logger', 'delete_role_logger',
  'message_edited_logger', 'message_deleted_logger',
  'join_voice_logger', 'leave_voice_logger', 'voice_state_logger', 'move_logger', 'disconnect_logger',
  'create_channel_logger', 'delete_channel_logger', 'channel_updated_logger', 'channel_permission_updated_logger',
  'automod_logger',
];

// "📁・Ban-Logger" -> "ban", "role_updated_logger" -> "role_updated", "LOGs" -> "logs"
const simplifyName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_logger$/, '');

const COLORS = { green: 0x57f287, red: 0xed4245, orange: 0xf0b232, blue: 0x5865f2 };

// Embed field for extra details (cut to Discord's 1024-character limit)
const field = (name, value, inline = false) => ({ name, value: String(value || '—').slice(0, 1024), inline });

// ProBot-style log: the member's avatar + username at the top, one short sentence, optional detail fields.
// `user` is who the log is about (for moderation: the member it was done to).
function logEmbed(color, { user, text, fields = [] }) {
  const embed = new EmbedBuilder().setColor(COLORS[color]).setDescription(text).addFields(fields.filter(Boolean));
  if (user) embed.setAuthor({ name: user.username, iconURL: user.displayAvatarURL?.() });
  return embed;
}

const timeText = (ms) => `<t:${Math.floor(ms / 1000)}:f> (<t:${Math.floor(ms / 1000)}:R>)`;

// "29/4/2021 8:04" in Istanbul time
function istanbulDate(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ms).map((p) => [p.type, p.value]));
  return `${Number(parts.day)}/${Number(parts.month)}/${parts.year} ${Number(parts.hour)}:${parts.minute}`;
}

// "5 years ago", "3 months ago", "a day ago" (like ProBot). Plain text, worked out when the log is written,
// so an old log keeps saying how long it was at that moment.
function ago(ms) {
  const sec = Math.max(0, (Date.now() - ms) / 1000);
  const min = sec / 60;
  const hours = min / 60;
  const days = hours / 24;
  const n = (value, unit, one) => (Math.round(value) <= 1 ? one : `${Math.round(value)} ${unit}s`);
  const text = sec < 45 ? 'a few seconds'
    : sec < 90 ? 'a minute'
    : min < 45 ? n(min, 'minute', 'a minute')
    : min < 90 ? 'an hour'
    : hours < 22 ? n(hours, 'hour', 'an hour')
    : hours < 36 ? 'a day'
    : days < 26 ? n(days, 'day', 'a day')
    : days < 45 ? 'a month'
    : days < 320 ? n(days / 30.44, 'month', 'a month')
    : days < 548 ? 'a year'
    : n(days / 365.25, 'year', 'a year');
  return `${text} ago`;
}

// "⏲ **Age of account:**" / `29/4/2021 8:04` / "**5 years ago**" (ProBot style)
const timeBlock = (label, ms) => `⏲ **${label}:**\n\`${istanbulDate(ms)}\`\n**${ago(ms)}**`;

async function sendLog(guild, type, embed) {
  const channelId = getSetting(guild.id, `log:${type}`);
  if (!channelId) return;
  // Every log ends with the server's icon + name and the time ("MamadPoker • Today at 2:23 AM")
  embed.setFooter({ text: guild.name, iconURL: guild.iconURL() }).setTimestamp();
  try {
    const channel = await guild.client.channels.fetch(channelId);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Could not send ${type} log in ${guild.name}:`, err.message);
  }
}

// Every channel that receives logs (anything set with /log)
const logChannelIds = (guildId) =>
  new Set(db.prepare("SELECT value FROM settings WHERE guild_id = ? AND key LIKE 'log:%'").all(guildId).map((r) => r.value));

// One of our own log embeds? (sendLog above gives every log the server name as footer, plus a timestamp)
const isOwnLog = (message) =>
  message.author?.id === message.client.user?.id && message.embeds.some((e) => e.footer?.text === message.guild.name && e.timestamp);

// Our /ban, /kick and /timeout run as the bot, so Discord's audit log says the bot did it.
// We add the real moderator to the audit reason, and read it back when logging.
const auditReason = (moderator, reason) => `${reason} (by ${moderator.username}, ${moderator.id})`;
function readAuditReason(reason) {
  const match = reason?.match(/^([\s\S]*) \(by [^,]+, (\d+)\)$/);
  return match ? { reason: match[1], moderatorId: match[2] } : { reason, moderatorId: null };
}

// ---- Who did it? (voice moves/disconnects, message deletes) ----

// Audit log entry id -> how many of its actions we've already matched to an event
const auditMatched = new Map();

// Discord groups repeated actions into one audit log entry with a count (and for voice moves it doesn't
// even say who the target was). So: wait a moment, then look for a matching entry that is new or whose
// count went up. Returns the executor's user id, or null if there's none (= the member did it themselves).
// ponytail: if a mod and a member do the same thing at the same moment, the two can be swapped. Rare;
// exact tracking isn't possible with what Discord provides.
async function findAuditExecutor(guild, type, { channelId, targetId } = {}) {
  await new Promise((resolve) => setTimeout(resolve, 1500)); // give Discord time to write the audit log
  const { entries } = await guild.fetchAuditLogs({ type, limit: 10 });
  for (const entry of entries.values()) {
    if (channelId && entry.extra?.channel?.id !== channelId) continue;
    if (targetId && entry.targetId !== targetId) continue;
    const count = entry.extra?.count ?? 1;
    // First time we see this entry: brand new = nothing matched yet; older = from before the bot started
    if (!auditMatched.has(entry.id)) auditMatched.set(entry.id, Date.now() - entry.createdTimestamp < 15_000 ? 0 : count);
    if (count > auditMatched.get(entry.id)) {
      auditMatched.set(entry.id, auditMatched.get(entry.id) + 1);
      return entry.executorId;
    }
  }
  return null;
}

// ---- Turning audit log changes into readable text ----

const permNames = (bits) => new PermissionsBitField(BigInt(bits ?? 0)).toArray();
const prettyPerm = (p) => p.replace(/([a-z])([A-Z])/g, '$1 $2'); // "SendMessages" -> "Send Messages"

// Only these changes are shown (the rest, like position, is noise)
const LABELS = {
  name: 'Name', color: 'Color', hoist: 'Shown separately', mentionable: 'Mentionable', permissions: 'Permissions',
  topic: 'Topic', nsfw: 'Age-restricted', rate_limit_per_user: 'Slowmode', bitrate: 'Bitrate', user_limit: 'User limit', parent_id: 'Category',
};

function showValue(key, value) {
  if (value === null || value === undefined || value === '') return '*none*';
  if (key === 'color') return `#${value.toString(16).padStart(6, '0')}`;
  if (key === 'parent_id') return `<#${value}>`;
  if (key === 'rate_limit_per_user') return `${value}s`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return `\`${String(value).slice(0, 200)}\``;
}

// mode: 'create' (show new values), 'delete' (show old values) or 'update' (old -> new). Returns '' if nothing worth showing.
function describeChanges(changes, mode) {
  const lines = [];
  for (const { key, old: before, new: after } of changes) {
    const label = LABELS[key];
    if (!label) continue;
    if (key === 'permissions') {
      const was = permNames(before);
      const now = permNames(after);
      const added = now.filter((p) => !was.includes(p)).map(prettyPerm);
      const removed = was.filter((p) => !now.includes(p)).map(prettyPerm);
      if (added.length) lines.push(`**${label} ➕** ${added.join(', ')}`);
      if (removed.length) lines.push(`**${label} ➖** ${removed.join(', ')}`);
    } else if (mode === 'update') {
      lines.push(`**${label}:** ${showValue(key, before)} → ${showValue(key, after)}`);
    } else {
      lines.push(`**${label}:** ${showValue(key, mode === 'create' ? after : before)}`);
    }
  }
  return lines.join('\n');
}

// Channel permission overwrites: shows each changed permission as ✅ allowed / ❌ denied / ⬜ default
function describeOverwrite(changes) {
  const get = (key, side) => permNames(changes.find((c) => c.key === key)?.[side]);
  const state = (side) => (p) => (get('allow', side).includes(p) ? '✅' : get('deny', side).includes(p) ? '❌' : '⬜');
  const before = state('old');
  const after = state('new');
  const touched = new Set(['allow', 'deny'].flatMap((key) => [...get(key, 'old'), ...get(key, 'new')]));
  return [...touched].filter((p) => before(p) !== after(p)).map((p) => `${prettyPerm(p)}: ${before(p)} → ${after(p)}`).join('\n');
}

module.exports = {
  LOG_TYPES, simplifyName, field, logEmbed, timeText, istanbulDate, ago, timeBlock, sendLog, logChannelIds, isOwnLog,
  auditReason, readAuditReason, findAuditExecutor, describeChanges, describeOverwrite,
};

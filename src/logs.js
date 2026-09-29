const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { getSetting } = require('./db');

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

// Embed field (cut to Discord's 1024-character limit). Returns null for empty optional fields.
const field = (name, value, inline = false) => ({ name, value: String(value || '—').slice(0, 1024), inline });

function logEmbed(color, title, fields) {
  return new EmbedBuilder().setColor(COLORS[color]).setTitle(title).addFields(fields.filter(Boolean)).setTimestamp();
}

const userText = (user) => `<@${user.id}> (${user.username})`;
const timeText = (ms) => `<t:${Math.floor(ms / 1000)}:f> (<t:${Math.floor(ms / 1000)}:R>)`;

async function sendLog(guild, type, embed) {
  const channelId = getSetting(guild.id, `log:${type}`);
  if (!channelId) return;
  try {
    const channel = await guild.client.channels.fetch(channelId);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Could not send ${type} log in ${guild.name}:`, err.message);
  }
}

// Our /ban, /kick and /timeout run as the bot, so Discord's audit log says the bot did it.
// We add the real moderator to the audit reason, and read it back when logging.
const auditReason = (moderator, reason) => `${reason} (by ${moderator.username}, ${moderator.id})`;
function readAuditReason(reason) {
  const match = reason?.match(/^([\s\S]*) \(by [^,]+, (\d+)\)$/);
  return match ? { reason: match[1], moderatorId: match[2] } : { reason, moderatorId: null };
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
  LOG_TYPES, simplifyName, field, logEmbed, userText, timeText, sendLog,
  auditReason, readAuditReason, describeChanges, describeOverwrite,
};

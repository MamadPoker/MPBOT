const { Events, AuditLogEvent } = require('discord.js');
const { getSetting } = require('../db');
const { field, logEmbed, userText, sendLog } = require('../logs');

const TOGGLES = [
  ['serverMute', 'Server muted', 'Server unmuted'],
  ['serverDeaf', 'Server deafened', 'Server undeafened'],
  ['selfMute', 'Muted', 'Unmuted'],
  ['selfDeaf', 'Deafened', 'Undeafened'],
];

// Audit log entry id -> how many of its moves/disconnects we've already matched to a member
const matched = new Map();

// Was this move/disconnect done by a moderator? Discord's audit log doesn't say WHO was moved, and groups
// repeats into one entry with a count. So: wait a moment, then look for an entry that's new or whose count went up.
// No match = the member did it themselves. Returns the moderator's user id, or null.
// ponytail: if a mod moves someone at the same moment another member moves themselves into the same channel,
// the two can be swapped. Rare; exact tracking isn't possible with what Discord provides.
async function findModerator(guild, type, channelId) {
  await new Promise((resolve) => setTimeout(resolve, 1500)); // give Discord time to write the audit log
  const { entries } = await guild.fetchAuditLogs({ type, limit: 10 });
  for (const entry of entries.values()) {
    if (channelId && entry.extra?.channel?.id !== channelId) continue; // moves: must be into the same channel
    const count = entry.extra?.count ?? 1;
    // First time we see this entry: brand new = nothing matched yet; older = from before the bot started
    if (!matched.has(entry.id)) matched.set(entry.id, Date.now() - entry.createdTimestamp < 15_000 ? 0 : count);
    if (count > matched.get(entry.id)) {
      matched.set(entry.id, matched.get(entry.id) + 1);
      return entry.executorId;
    }
  }
  return null;
}

// Only asks the audit log if that log channel is set up (saves requests on busy servers)
async function modLogVoice(guild, logType, auditType, channelId, makeEmbed) {
  if (!getSetting(guild.id, `log:${logType}`)) return;
  const modId = await findModerator(guild, auditType, channelId).catch((err) => {
    console.error(`Could not read the audit log in ${guild.name}:`, err.message);
    return null;
  });
  if (!modId) return;
  const mod = await guild.client.users.fetch(modId).catch(() => null);
  await sendLog(guild, logType, makeEmbed(field('By', mod ? userText(mod) : `<@${modId}>`, true)));
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(before, after) {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const { guild } = after;
    const who = field('Member', userText(member.user), true);

    if (!before.channelId && after.channelId) {
      return sendLog(guild, 'join_voice_logger', logEmbed('green', 'Joined voice', [who, field('Channel', `<#${after.channelId}>`, true)]));
    }
    if (before.channelId && !after.channelId) {
      await sendLog(guild, 'leave_voice_logger', logEmbed('red', 'Left voice', [who, field('Channel', `<#${before.channelId}>`, true)]));
      return modLogVoice(guild, 'disconnect_logger', AuditLogEvent.MemberDisconnect, null, (by) =>
        logEmbed('red', 'Disconnected from voice', [who, by, field('Channel', `<#${before.channelId}>`, true)]),
      );
    }

    const changes = [];
    if (before.channelId !== after.channelId) changes.push(`Moved: <#${before.channelId}> → <#${after.channelId}>`);
    for (const [key, on, off] of TOGGLES) {
      if (before[key] !== after[key]) changes.push(after[key] ? on : off);
    }
    if (changes.length) {
      await sendLog(guild, 'voice_state_logger', logEmbed('orange', 'Voice state changed', [
        who, field('Channel', `<#${after.channelId}>`, true), field('Change', changes.join('\n')),
      ]));
    }
    if (before.channelId !== after.channelId) {
      await modLogVoice(guild, 'move_logger', AuditLogEvent.MemberMove, after.channelId, (by) =>
        logEmbed('orange', 'Moved by a moderator', [who, by, field('From', `<#${before.channelId}>`, true), field('To', `<#${after.channelId}>`, true)]),
      );
    }
  },
};

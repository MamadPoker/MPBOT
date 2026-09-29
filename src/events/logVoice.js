const { Events, AuditLogEvent } = require('discord.js');
const { getSetting } = require('../db');
const { logEmbed, sendLog, findAuditExecutor } = require('../logs');

// [voice state flag, text when turned on, text when turned off]
const TOGGLES = [
  ['selfMute', 'muted themselves', 'unmuted themselves'],
  ['selfDeaf', 'deafened themselves', 'undeafened themselves'],
  ['serverMute', 'was server muted', 'was server unmuted'],
  ['serverDeaf', 'was server deafened', 'was server undeafened'],
];

// Was this move/disconnect done by a moderator? No match in the audit log = the member did it themselves.
// Only asks the audit log if that log channel is set up (saves requests on busy servers)
async function modLogVoice(guild, logType, auditType, channelId, makeEmbed) {
  if (!getSetting(guild.id, `log:${logType}`)) return;
  const modId = await findAuditExecutor(guild, auditType, { channelId }).catch((err) => {
    console.error(`Could not read the audit log in ${guild.name}:`, err.message);
    return null;
  });
  if (modId) await sendLog(guild, logType, makeEmbed(`<@${modId}>`));
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(before, after) {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;
    const { guild } = after;
    const user = member.user;
    const who = `<@${user.id}>`;
    const from = `<#${before.channelId}>`; // Discord shows voice channel mentions as "🔊 name"
    const to = `<#${after.channelId}>`;

    if (!before.channelId && after.channelId) {
      return sendLog(guild, 'join_voice_logger', logEmbed('green', { user, text: `${who} joined voice channel ${to}.` }));
    }
    if (before.channelId && !after.channelId) {
      await sendLog(guild, 'leave_voice_logger', logEmbed('red', { user, text: `${who} left voice channel ${from}.` }));
      return modLogVoice(guild, 'disconnect_logger', AuditLogEvent.MemberDisconnect, null, (mod) =>
        logEmbed('red', { user, text: `${who} was disconnected from ${from} by ${mod}.` }),
      );
    }

    const lines = [];
    if (before.channelId !== after.channelId) lines.push(`${who} moved from ${from} to ${to}.`);
    for (const [key, on, off] of TOGGLES) {
      if (before[key] !== after[key]) lines.push(`${who} ${after[key] ? on : off} in ${to}.`);
    }
    if (lines.length) await sendLog(guild, 'voice_state_logger', logEmbed('orange', { user, text: lines.join('\n') }));

    if (before.channelId !== after.channelId) {
      await modLogVoice(guild, 'move_logger', AuditLogEvent.MemberMove, after.channelId, (mod) =>
        logEmbed('orange', { user, text: `${who} was moved from ${from} to ${to} by ${mod}.` }),
      );
    }
  },
};

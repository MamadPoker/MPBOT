const { Events, AuditLogEvent } = require('discord.js');
const { getSetting } = require('../db');
const { field, logEmbed, userText, sendLog, findAuditExecutor } = require('../logs');

const TOGGLES = [
  ['serverMute', 'Server muted', 'Server unmuted'],
  ['serverDeaf', 'Server deafened', 'Server undeafened'],
  ['selfMute', 'Muted', 'Unmuted'],
  ['selfDeaf', 'Deafened', 'Undeafened'],
];

// Was this move/disconnect done by a moderator? No match in the audit log = the member did it themselves.
// Only asks the audit log if that log channel is set up (saves requests on busy servers)
async function modLogVoice(guild, logType, auditType, channelId, makeEmbed) {
  if (!getSetting(guild.id, `log:${logType}`)) return;
  const modId = await findAuditExecutor(guild, auditType, { channelId }).catch((err) => {
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

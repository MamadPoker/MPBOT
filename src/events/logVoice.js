const { Events, AuditLogEvent } = require('discord.js');
const { getSetting } = require('../db');
const { logEmbed, sendLog, findAuditExecutor } = require('../logs');

// [voice state flag, text when turned on, text when turned off]
const TOGGLES = [
  ['selfMute', '**muted themselves**', '**unmuted themselves**'],
  ['selfDeaf', '**deafened themselves**', '**undeafened themselves**'],
  ['serverMute', '**was server muted**', '**was server unmuted**'],
  ['serverDeaf', '**was server deafened**', '**was server undeafened**'],
];

const logOn = (guild, type) => Boolean(getSetting(guild.id, `log:${type}`));

// Was this move/disconnect done by a moderator? Returns their id, or null (= the member did it themselves)
function findModerator(guild, auditType, channelId) {
  return findAuditExecutor(guild, auditType, { channelId }).catch((err) => {
    console.error(`Could not read the audit log in ${guild.name}:`, err.message);
    return null;
  });
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

    const logJoin = () => sendLog(guild, 'join_voice_logger', logEmbed('green', { user, text: `${who} **joined voice channel** ${to}.` }));
    const logLeave = () => sendLog(guild, 'leave_voice_logger', logEmbed('red', { user, text: `${who} **left voice channel** ${from}.` }));

    // Same channel but a new voice session: they dropped and came back in one update (e.g. Discord reloaded
    // with Ctrl+R, or they rejoined from another device). Log it like a normal leave + join.
    const rejoined = before.channelId && before.channelId === after.channelId
      && before.sessionId && after.sessionId && before.sessionId !== after.sessionId;
    if (rejoined) {
      await logLeave();
      return logJoin();
    }

    if (!before.channelId && after.channelId) return logJoin();
    if (before.channelId && !after.channelId) {
      await logLeave(); // sent right away; the moderator check below doesn't delay it or a quick rejoin
      if (!logOn(guild, 'disconnect_logger')) return; // don't read the audit log for nothing
      const modId = await findModerator(guild, AuditLogEvent.MemberDisconnect, null);
      if (modId) await sendLog(guild, 'disconnect_logger', logEmbed('red', { user, text: `${who} **was disconnected** by <@${modId}> from ${from}.` }));
      return;
    }

    const lines = [];
    if (before.channelId !== after.channelId) {
      // Moved by a moderator -> move_logger ("was moved"). By themselves -> voice_state_logger ("switched").
      const check = logOn(guild, 'move_logger') || logOn(guild, 'voice_state_logger');
      const modId = check ? await findModerator(guild, AuditLogEvent.MemberMove, after.channelId) : null;
      if (modId) await sendLog(guild, 'move_logger', logEmbed('orange', { user, text: `${who} **was moved** by <@${modId}> from ${from} to ${to}.` }));
      else lines.push(`${who} **switched voice channel** ${from} => ${to}.`);
    }
    for (const [key, on, off] of TOGGLES) {
      if (before[key] !== after[key]) lines.push(`${who} ${after[key] ? on : off} in ${to}.`);
    }
    if (lines.length) await sendLog(guild, 'voice_state_logger', logEmbed('orange', { user, text: lines.join('\n') }));
  },
};

const { Events } = require('discord.js');
const { field, logEmbed, userText, sendLog } = require('../logs');

const TOGGLES = [
  ['serverMute', 'Server muted', 'Server unmuted'],
  ['serverDeaf', 'Server deafened', 'Server undeafened'],
  ['selfMute', 'Muted', 'Unmuted'],
  ['selfDeaf', 'Deafened', 'Undeafened'],
];

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
      return sendLog(guild, 'leave_voice_logger', logEmbed('red', 'Left voice', [who, field('Channel', `<#${before.channelId}>`, true)]));
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
  },
};

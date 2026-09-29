const { Events } = require('discord.js');
const { field, logEmbed, userText, sendLog } = require('../logs');

const UNKNOWN = '*Unknown (sent before the bot started)*';

module.exports = [
  {
    name: Events.MessageUpdate,
    async execute(before, after) {
      if (!after.guild || after.author?.bot) return;
      if (before.content === after.content) return; // e.g. a link preview loaded, not a real edit
      await sendLog(after.guild, 'message_edited_logger', logEmbed('orange', 'Message edited', [
        field('Author', userText(after.author), true),
        field('Channel', `${after.channel}`, true),
        field('Before', before.partial ? UNKNOWN : before.content || '*No text*'),
        field('After', after.content || '*No text*'),
        field('Message', `[Jump to message](${after.url})`),
      ]));
    },
  },
  {
    name: Events.MessageDelete,
    async execute(message) {
      if (!message.guild || message.author?.bot) return;
      const files = message.attachments?.map((a) => a.name).join(', ');
      await sendLog(message.guild, 'message_deleted_logger', logEmbed('red', 'Message deleted', [
        field('Author', message.author ? userText(message.author) : 'Unknown', true),
        field('Channel', `${message.channel}`, true),
        field('Content', message.partial ? UNKNOWN : message.content || '*No text*'),
        files && field('Attachments', files),
      ]));
    },
  },
];

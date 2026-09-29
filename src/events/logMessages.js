const { Events, AuditLogEvent } = require('discord.js');
const { db, getSetting } = require('../db');
const { field, logEmbed, sendLog, findAuditExecutor } = require('../logs');

const UNKNOWN = '*Unknown (sent more than 7 days ago, or before message logs were set up)*';
const KEEP_FOR = 7 * 24 * 60 * 60 * 1000; // stored messages are deleted after 7 days

// Only store messages for servers that actually use the message logs
const logsMessages = (guildId) => getSetting(guildId, 'log:message_deleted_logger') || getSetting(guildId, 'log:message_edited_logger');
const getStored = (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id);

module.exports = [
  {
    // Remember every message, so the logs still know it after a restart
    name: Events.MessageCreate,
    execute(message) {
      if (!message.guild || message.author.bot || message.system || !logsMessages(message.guild.id)) return;
      db.prepare(`
        INSERT OR REPLACE INTO messages (id, guild_id, channel_id, author_id, author_name, content, attachments, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id, message.guild.id, message.channelId, message.author.id, message.author.username,
        message.content, message.attachments.map((a) => a.name).join(', '), message.createdTimestamp,
      );
    },
  },
  {
    name: Events.ClientReady,
    once: true,
    execute() {
      const cleanup = () => db.prepare('DELETE FROM messages WHERE created_at < ?').run(Date.now() - KEEP_FOR);
      cleanup();
      setInterval(cleanup, 60 * 60 * 1000); // every hour
    },
  },

  {
    name: Events.MessageUpdate,
    async execute(before, after) {
      if (!after.guild || !after.author || after.author.bot) return;
      if (before.content === after.content) return; // e.g. a link preview loaded, not a real edit
      const old = before.partial ? getStored(after.id)?.content : before.content;
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(after.content, after.id);
      await sendLog(after.guild, 'message_edited_logger', logEmbed('orange', {
        user: after.author,
        text: `<@${after.author.id}> edited a message in <#${after.channelId}>. [Jump to message](${after.url})`,
        fields: [field('Before', old == null ? UNKNOWN : old || '*No text*'), field('After', after.content || '*No text*')],
      }));
    },
  },

  {
    name: Events.MessageDelete,
    async execute(message) {
      if (!message.guild) return;
      const stored = getStored(message.id);
      db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);

      // After a restart Discord only tells us the message id, so use the stored copy
      const author = message.author ?? (stored && { id: stored.author_id, username: stored.author_name });
      if (author?.bot || !getSetting(message.guild.id, 'log:message_deleted_logger')) return;
      const content = message.partial ? stored?.content : message.content;
      const files = message.partial ? stored?.attachments : message.attachments.map((a) => a.name).join(', ');

      // A moderator's delete shows up in the audit log; deleting your own message doesn't
      const channel = `<#${message.channelId}>`;
      let text = `A message was deleted in ${channel}.`; // author unknown
      if (author) {
        const modId = await findAuditExecutor(message.guild, AuditLogEvent.MessageDelete, { channelId: message.channelId, targetId: author.id })
          .catch((err) => console.error(`Could not read the audit log in ${message.guild.name}:`, err.message));
        text = modId ? `<@${author.id}>'s message was deleted by <@${modId}> in ${channel}.`
          : modId === null ? `<@${author.id}> deleted their message in ${channel}.`
          : `A message by <@${author.id}> was deleted in ${channel}.`; // audit log unreadable
      }

      await sendLog(message.guild, 'message_deleted_logger', logEmbed('red', {
        // The stored copy only has the id + name, so fetch the user for their avatar
        user: author && (message.author ?? (await message.client.users.fetch(author.id).catch(() => author))),
        text,
        fields: [field('Content', content == null ? UNKNOWN : content || '*No text*'), files && field('Attachments', files)],
      }));
    },
  },
];

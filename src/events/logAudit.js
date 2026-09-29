const { Events, AuditLogEvent: A } = require('discord.js');
const { field, logEmbed, timeText, sendLog, readAuditReason, describeChanges, describeOverwrite } = require('../logs');

// Discord sends every new audit log entry here (needs the "View Audit Log" permission).
// This catches actions done with our commands, by right-clicking in Discord, or by other bots.

// [log type, color, verb]
const MEMBER_ACTIONS = {
  [A.MemberKick]: ['kick-logger', 'red', 'kicked'],
  [A.MemberBanAdd]: ['ban-logger', 'red', 'banned'],
  [A.MemberBanRemove]: ['unban-logger', 'green', 'unbanned'],
};

// [log type, color, verb, mode, isRole]
const ROLE_AND_CHANNEL_ACTIONS = {
  [A.RoleCreate]: ['create-role-logger', 'green', 'created', 'create', true],
  [A.RoleUpdate]: ['role_updated_logger', 'orange', 'updated', 'update', true],
  [A.RoleDelete]: ['delete_role_logger', 'red', 'deleted', 'delete', true],
  [A.ChannelCreate]: ['create_channel_logger', 'green', 'created', 'create', false],
  [A.ChannelUpdate]: ['channel_updated_logger', 'orange', 'updated', 'update', false],
  [A.ChannelDelete]: ['delete_channel_logger', 'red', 'deleted', 'delete', false],
};

const OVERWRITE_ACTIONS = [A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete];

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    const { client } = guild;
    const fetchUser = (id) => (id ? client.users.fetch(id).catch(() => null) : null);

    // Only trust a "(by moderator)" reason if the bot itself did the action (our /ban /kick /timeout)
    const fromUs = entry.executorId === client.user.id;
    const { reason, moderatorId } = fromUs ? readAuditReason(entry.reason) : { reason: entry.reason, moderatorId: null };
    const executorId = moderatorId ?? entry.executorId;
    const by = executorId ? `<@${executorId}>` : 'someone';
    const withReason = (text) => (reason ? `${text}\n**Reason:** ${reason}` : text);
    // For member actions the log is about the member it was done to
    const target = `<@${entry.targetId}>`;
    const targetUser = () => fetchUser(entry.targetId);

    if (MEMBER_ACTIONS[entry.action]) {
      const [type, color, verb] = MEMBER_ACTIONS[entry.action];
      return sendLog(guild, type, logEmbed(color, { user: await targetUser(), text: withReason(`${target} was ${verb} by ${by}.`) }));
    }

    if (entry.action === A.MemberUpdate) {
      const user = await targetUser();
      for (const { key, old: before, new: after } of entry.changes) {
        if (key === 'communication_disabled_until') {
          await sendLog(guild, 'timeout-logger', after
            ? logEmbed('orange', { user, text: withReason(`${target} was timed out by ${by} until ${timeText(new Date(after).getTime())}.`) })
            : logEmbed('green', { user, text: withReason(`${target}'s timeout was removed by ${by}.`) }));
        }
        if (key === 'nick') {
          const text = executorId === entry.targetId ? `${target} changed their nickname.` : `${target}'s nickname was changed by ${by}.`;
          await sendLog(guild, 'change-nickname-logger', logEmbed('blue', {
            user, text, fields: [field('Before', before ?? '*none*', true), field('After', after ?? '*none*', true)],
          }));
        }
      }
      return;
    }

    if (entry.action === A.MemberRoleUpdate) {
      const roles = (key) => (entry.changes.find((c) => c.key === key)?.new ?? []).map((r) => `<@&${r.id}>`);
      const added = roles('$add');
      const removed = roles('$remove');
      const the = (list) => `the role${list.length > 1 ? 's' : ''} ${list.join(', ')}`;
      let color = 'blue';
      let text = `${target}'s roles were changed by ${by}.`;
      let fields = [field('Added', added.join(' '), true), field('Removed', removed.join(' '), true)];
      if (!removed.length) [color, text, fields] = ['green', `${target} was given ${the(added)} by ${by}.`, []];
      if (!added.length) [color, text, fields] = ['red', `${target} was removed from ${the(removed)} by ${by}.`, []];
      return sendLog(guild, 'give-role-logger', logEmbed(color, { user: await targetUser(), text: withReason(text), fields }));
    }

    if (ROLE_AND_CHANNEL_ACTIONS[entry.action]) {
      const [type, color, verb, mode, isRole] = ROLE_AND_CHANNEL_ACTIONS[entry.action];
      const details = describeChanges(entry.changes, mode);
      if (!details && mode === 'update') return; // e.g. only the position changed
      const name = entry.target?.name ?? entry.changes.find((c) => c.key === 'name')?.[mode === 'create' ? 'new' : 'old'];
      // A deleted role/channel can't be mentioned anymore, so show its name
      const thing = mode === 'delete' ? `**${isRole ? '@' : '#'}${name}**` : isRole ? `<@&${entry.targetId}>` : `<#${entry.targetId}>`;
      return sendLog(guild, type, logEmbed(color, {
        user: await fetchUser(executorId),
        text: withReason(`${by} ${verb} the ${isRole ? 'role' : 'channel'} ${thing}.`),
        fields: details ? [field(mode === 'update' ? 'Changes' : 'Details', details)] : [],
      }));
    }

    if (OVERWRITE_ACTIONS.includes(entry.action)) {
      const who = entry.extra; // the role or member these channel permissions are for
      const forWho = who?.id === guild.id ? '@everyone' : who?.user || String(who?.type) === '1' ? `<@${who?.id}>` : `<@&${who?.id}>`;
      return sendLog(guild, 'channel_permission_updated_logger', logEmbed('orange', {
        user: await fetchUser(executorId),
        text: withReason(`${by} changed the permissions of ${forWho} in <#${entry.targetId}>.`),
        fields: [field('Changes (✅ allowed, ❌ denied, ⬜ default)', describeOverwrite(entry.changes))],
      }));
    }
  },
};

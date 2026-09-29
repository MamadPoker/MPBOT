const { Events, AuditLogEvent: A } = require('discord.js');
const { field, logEmbed, userText, timeText, sendLog, readAuditReason, describeChanges, describeOverwrite } = require('../logs');

// Discord sends every new audit log entry here (needs the "View Audit Log" permission).
// This catches actions done with our commands, by right-clicking in Discord, or by other bots.

const MEMBER_ACTIONS = {
  [A.MemberKick]: ['kick-logger', 'red', 'Member kicked'],
  [A.MemberBanAdd]: ['ban-logger', 'red', 'Member banned'],
  [A.MemberBanRemove]: ['unban-logger', 'green', 'Member unbanned'],
};

// [log type, color, title, mode, isRole]
const ROLE_AND_CHANNEL_ACTIONS = {
  [A.RoleCreate]: ['create-role-logger', 'green', 'Role created', 'create', true],
  [A.RoleUpdate]: ['role_updated_logger', 'orange', 'Role updated', 'update', true],
  [A.RoleDelete]: ['delete_role_logger', 'red', 'Role deleted', 'delete', true],
  [A.ChannelCreate]: ['create_channel_logger', 'green', 'Channel created', 'create', false],
  [A.ChannelUpdate]: ['channel_updated_logger', 'orange', 'Channel updated', 'update', false],
  [A.ChannelDelete]: ['delete_channel_logger', 'red', 'Channel deleted', 'delete', false],
};

const OVERWRITE_ACTIONS = [A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete];

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    const { client } = guild;
    const fetchUser = (id) => (id ? client.users.fetch(id).catch(() => null) : null);
    const mention = (user, id) => (user ? userText(user) : id ? `<@${id}>` : 'Unknown');

    // Only trust a "(by moderator)" reason if the bot itself did the action
    const fromUs = entry.executorId === client.user.id;
    const { reason, moderatorId } = fromUs ? readAuditReason(entry.reason) : { reason: entry.reason, moderatorId: null };
    const executor = await fetchUser(moderatorId ?? entry.executorId);
    const by = field('By', mention(executor, entry.executorId) + (moderatorId ? ` via ${client.user}` : ''), true);
    const why = reason && field('Reason', reason, true);
    const targetMember = async () => field('Member', mention(await fetchUser(entry.targetId), entry.targetId), true);

    if (MEMBER_ACTIONS[entry.action]) {
      const [type, color, title] = MEMBER_ACTIONS[entry.action];
      return sendLog(guild, type, logEmbed(color, title, [await targetMember(), by, why]));
    }

    if (entry.action === A.MemberUpdate) {
      const member = await targetMember();
      for (const { key, old: before, new: after } of entry.changes) {
        if (key === 'communication_disabled_until') {
          await sendLog(guild, 'timeout-logger', after
            ? logEmbed('orange', 'Member timed out', [member, by, field('Until', timeText(new Date(after).getTime()), true), why])
            : logEmbed('green', 'Timeout removed', [member, by, why]));
        }
        if (key === 'nick') {
          await sendLog(guild, 'change-nickname-logger', logEmbed('blue', 'Nickname changed', [
            member, by, field('Before', before ?? '*none*', true), field('After', after ?? '*none*', true),
          ]));
        }
      }
      return;
    }

    if (entry.action === A.MemberRoleUpdate) {
      const list = (key, sign) => (entry.changes.find((c) => c.key === key)?.new ?? []).map((r) => `${sign} <@&${r.id}> (${r.name})`);
      const added = list('$add', '➕');
      const removed = list('$remove', '➖');
      const color = removed.length ? (added.length ? 'blue' : 'red') : 'green';
      return sendLog(guild, 'give-role-logger', logEmbed(color, 'Member roles changed', [
        await targetMember(), by, field('Roles', [...added, ...removed].join('\n')), why,
      ]));
    }

    if (ROLE_AND_CHANNEL_ACTIONS[entry.action]) {
      const [type, color, title, mode, isRole] = ROLE_AND_CHANNEL_ACTIONS[entry.action];
      const details = describeChanges(entry.changes, mode);
      if (!details && mode === 'update') return; // e.g. only the position changed
      const name = entry.target?.name ?? entry.changes.find((c) => c.key === 'name')?.[mode === 'create' ? 'new' : 'old'];
      const target = mode === 'delete' ? `**${name}**` : `${isRole ? `<@&${entry.targetId}>` : `<#${entry.targetId}>`} (${name})`;
      return sendLog(guild, type, logEmbed(color, title, [field(isRole ? 'Role' : 'Channel', target, true), by, field('Details', details), why]));
    }

    if (OVERWRITE_ACTIONS.includes(entry.action)) {
      const who = entry.extra; // the role or member these channel permissions are for
      const forWho = who?.id === guild.id ? '@everyone' : who?.user || String(who?.type) === '1' ? `<@${who?.id}>` : `<@&${who?.id}>`;
      return sendLog(guild, 'channel_permission_updated_logger', logEmbed('orange', 'Channel permissions changed', [
        field('Channel', `<#${entry.targetId}>`, true), field('For', forWho, true), by,
        field('Changes (✅ allowed, ❌ denied, ⬜ default)', describeOverwrite(entry.changes)), why,
      ]));
    }
  },
};

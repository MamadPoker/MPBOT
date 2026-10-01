const { Events, AuditLogEvent: A } = require('discord.js');
const {
  logEmbed, label, moderatorLine, lines, durationText, timeText, sendLog, readAuditReason, describeChanges, describeOverwrite,
} = require('../logs');

// Discord sends every new audit log entry here (needs the "View Audit Log" permission).
// This catches actions done with our commands, by right-clicking in Discord, or by other bots.

// [log type, color, title line]
const MEMBER_ACTIONS = {
  [A.MemberKick]: ['kick-logger', 'red', (t) => `👋 ${t} **kicked.**`],
  [A.MemberBanAdd]: ['ban-logger', 'red', (t) => `🔨 ${t} **banned.**`],
  [A.MemberBanRemove]: ['unban-logger', 'green', (t) => `🔓 ${t} **unbanned.**`],
};

// [log type, color, emoji + title, mode, isRole]
const ROLE_AND_CHANNEL_ACTIONS = {
  [A.RoleCreate]: ['create-role-logger', 'green', '🎭 **Role Created:**', 'create', true],
  [A.RoleUpdate]: ['role_updated_logger', 'orange', '🎭 **Role Updated:**', 'update', true],
  [A.RoleDelete]: ['delete_role_logger', 'red', '🎭 **Role Deleted:**', 'delete', true],
  [A.ChannelCreate]: ['create_channel_logger', 'green', '🏠 **Channel Created:**', 'create', false],
  [A.ChannelUpdate]: ['channel_updated_logger', 'orange', '✏ **Channel Updated:**', 'update', false],
  [A.ChannelDelete]: ['delete_channel_logger', 'red', '🗑 **Channel Deleted:**', 'delete', false],
};

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    const { client } = guild;
    const fetchUser = (id) => (id ? client.users.fetch(id).catch(() => null) : null);

    // Only trust a "(by moderator)" reason if the bot itself did the action (our /ban /kick /timeout)
    const fromUs = entry.executorId === client.user.id;
    const { reason, moderatorId } = fromUs ? readAuditReason(entry.reason) : { reason: entry.reason, moderatorId: null };
    const moderator = moderatorLine(moderatorId ?? entry.executorId);
    const why = label('Reason', reason);
    // Member logs are about the member it was done to: their avatar and name on top, big avatar on the right
    const target = `<@${entry.targetId}>`;
    const memberLog = async (color, text) => logEmbed(color, { user: await fetchUser(entry.targetId), text, thumbnail: true });

    if (MEMBER_ACTIONS[entry.action]) {
      const [type, color, title] = MEMBER_ACTIONS[entry.action];
      return sendLog(guild, type, await memberLog(color, lines(title(target), moderator, why)));
    }

    if (entry.action === A.MemberUpdate) {
      for (const { key, old: before, new: after } of entry.changes) {
        if (key === 'communication_disabled_until') {
          const until = after && new Date(after).getTime();
          await sendLog(guild, 'timeout-logger', until
            ? await memberLog('orange', lines(`⏳ ${target} **timed out.**`, label('Duration', durationText(until - Date.now())), label('Ends', timeText(until)), moderator, why))
            : await memberLog('green', lines(`✅ ${target} **timeout removed.**`, moderator, why)));
        }
        if (key === 'nick') {
          const nick = (n) => (n ? `\`${n}\`` : '*none*');
          await sendLog(guild, 'change-nickname-logger', await memberLog('blue',
            lines(`✍ ${target} **has been updated.**`, label('Nickname', `${nick(before)} → ${nick(after)}`), moderator, why)));
        }
      }
      return;
    }

    if (entry.action === A.MemberRoleUpdate) {
      const roles = (key, emoji) => (entry.changes.find((c) => c.key === key)?.new ?? []).map((r) => `${emoji} <@&${r.id}>`);
      const added = roles('$add', '✅');
      const removed = roles('$remove', '⛔');
      const color = removed.length ? (added.length ? 'blue' : 'red') : 'green';
      return sendLog(guild, 'give-role-logger', await memberLog(color,
        lines(`✍ ${target} **has been updated.**`, label('Roles', lines(added, removed)), moderator, why)));
    }

    // Channel and role logs: the server on top
    if (ROLE_AND_CHANNEL_ACTIONS[entry.action]) {
      const [type, color, title, mode, isRole] = ROLE_AND_CHANNEL_ACTIONS[entry.action];
      const details = describeChanges(entry.changes, mode);
      if (!details && mode === 'update') return; // e.g. only the position changed
      const name = entry.target?.name ?? entry.changes.find((c) => c.key === 'name')?.[mode === 'create' ? 'new' : 'old'];
      // A deleted role/channel can't be mentioned anymore, so only its name
      const mention = mode === 'delete' ? '' : isRole ? ` (<@&${entry.targetId}>)` : ` (<#${entry.targetId}>)`;
      return sendLog(guild, type, logEmbed(color, { server: guild, text: lines(`${title} \`${name}\`${mention}`, details, moderator, why) }));
    }

    if ([A.ChannelOverwriteCreate, A.ChannelOverwriteUpdate, A.ChannelOverwriteDelete].includes(entry.action)) {
      const who = entry.extra; // the role or member these channel permissions are for
      const isMember = Boolean(who?.user) || String(who?.type) === '1';
      const forWho = who?.id === guild.id ? '@everyone' : isMember ? `<@${who?.id}>` : `<@&${who?.id}>`;
      const override = entry.action === A.ChannelOverwriteCreate ? `➕ Added an override for ${forWho}`
        : entry.action === A.ChannelOverwriteDelete ? `➖ Removed the override for ${forWho}` : null;
      return sendLog(guild, 'channel_permission_updated_logger', logEmbed('orange', {
        server: guild,
        text: lines(
          `🔐 **Permissions changed** in <#${entry.targetId}>`, // Discord shows the right channel icon (#, 🔊, ...)
          label('For', `${forWho} (${isMember ? 'member' : 'role'})`),
          override,
          describeOverwrite(entry.changes),
          moderator,
          why,
        ),
      }));
    }
  },
};

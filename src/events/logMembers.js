const { Events } = require('discord.js');
const { field, logEmbed, userText, timeText, sendLog } = require('../logs');

// Invite tracking: remember how many times each invite was used, then see which count went up when someone joins.
// ponytail: if two people join at the exact same moment their invites can get mixed up; fine for normal servers.
const inviteCache = new Map(); // server id -> Map(code -> { uses, maxUses, inviterId })

async function refreshInvites(guild) {
  const invites = await guild.invites.fetch(); // needs the "Manage Server" permission
  const now = new Map(invites.map((i) => [i.code, { uses: i.uses, maxUses: i.maxUses, inviterId: i.inviterId }]));
  const before = inviteCache.get(guild.id);
  inviteCache.set(guild.id, now);
  return { before, now };
}

async function findUsedInvite(guild) {
  const { before, now } = await refreshInvites(guild);
  if (!before) return null; // no earlier snapshot to compare with
  for (const [code, invite] of now) {
    if (invite.uses > (before.get(code)?.uses ?? 0)) return { code, ...invite };
  }
  // One-time invites disappear the moment they're used
  for (const [code, invite] of before) {
    if (!now.has(code) && invite.maxUses && invite.uses + 1 >= invite.maxUses) return { code, ...invite, uses: invite.uses + 1 };
  }
  return null;
}

const snapshot = (guild) => refreshInvites(guild).catch(() => {}); // no permission = no invite tracking

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    execute: (client) => Promise.all(client.guilds.cache.map(snapshot)),
  },
  { name: Events.GuildCreate, execute: snapshot }, // bot added to a new server
  {
    name: Events.InviteCreate,
    execute(invite) {
      inviteCache.get(invite.guild?.id)?.set(invite.code, { uses: 0, maxUses: invite.maxUses, inviterId: invite.inviterId });
    },
  },

  {
    name: Events.GuildMemberAdd,
    async execute(member) {
      const { guild, user } = member;
      await sendLog(guild, 'join-server', logEmbed('green', 'Member joined', [
        field('Member', userText(user)),
        field('Account created', timeText(user.createdTimestamp), true),
        field('Member count', guild.memberCount, true),
      ]).setThumbnail(user.displayAvatarURL()));

      let inviteFields;
      try {
        const invite = await findUsedInvite(guild);
        inviteFields = invite
          ? [field('Invite', `discord.gg/${invite.code}`, true), field('Created by', invite.inviterId ? `<@${invite.inviterId}>` : 'Unknown', true), field('Uses', invite.uses, true)]
          : [field('Invite', guild.vanityURLCode ? `Probably the vanity link discord.gg/${guild.vanityURLCode}` : 'Unknown')];
      } catch {
        inviteFields = [field('Invite', 'Unknown: I need the **Manage Server** permission to see invites')];
      }
      await sendLog(guild, 'invite', logEmbed('blue', 'Joined with invite', [field('Member', userText(user)), ...inviteFields]));
    },
  },

  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      const roles = member.partial ? 'Unknown' : member.roles.cache.filter((r) => r.id !== member.guild.id).map(String).join(' ') || 'None';
      await sendLog(member.guild, 'left-server', logEmbed('red', 'Member left', [
        field('Member', userText(member.user)),
        field('Joined', member.joinedTimestamp ? timeText(member.joinedTimestamp) : 'Unknown', true),
        field('Member count', member.guild.memberCount, true),
        field('Roles', roles),
      ]).setThumbnail(member.user.displayAvatarURL()));
    },
  },
];

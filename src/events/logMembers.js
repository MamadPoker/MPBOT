const { Events } = require('discord.js');
const { field, logEmbed, timeBlock, sendLog } = require('../logs');

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
      const who = `<@${user.id}>`;
      // ProBot style: the sentence, then the account age; the avatar big on the right
      await sendLog(guild, 'join-server', logEmbed('green', {
        user,
        text: `${who} joined the server.\n${timeBlock('Age of account', user.createdTimestamp)}`,
      }).setThumbnail(user.displayAvatarURL({ size: 256 })));

      let text;
      try {
        const invite = await findUsedInvite(guild);
        if (invite) {
          const creator = invite.inviterId ? ` created by <@${invite.inviterId}>` : '';
          text = `${who} joined using invite **discord.gg/${invite.code}**${creator} (used ${invite.uses} times).`;
        } else if (guild.vanityURLCode) {
          text = `${who} joined, probably using the vanity link **discord.gg/${guild.vanityURLCode}**.`;
        } else {
          text = `${who} joined, but I couldn't tell which invite they used.`;
        }
      } catch {
        text = `${who} joined, but I need the **Manage Server** permission to see which invite they used.`;
      }
      await sendLog(guild, 'invite', logEmbed('blue', { user, text }));
    },
  },

  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      const roles = member.partial ? 'Unknown' : member.roles.cache.filter((r) => r.id !== member.guild.id).map(String).join(' ') || 'None';
      // Same style: the sentence, then when they joined (= how long they were in the server)
      const joined = member.joinedTimestamp ? timeBlock('Joined', member.joinedTimestamp) : '⏲ **Joined:** Unknown';
      await sendLog(member.guild, 'left-server', logEmbed('red', {
        user: member.user,
        text: `<@${member.user.id}> left the server.\n${joined}`,
        fields: [field('Roles', roles)],
      }).setThumbnail(member.user.displayAvatarURL({ size: 256 })));
    },
  },
];

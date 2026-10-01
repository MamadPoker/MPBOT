const { Events } = require('discord.js');
const { logEmbed, label, lines, timeBlock, sendLog } = require('../logs');

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
        user, thumbnail: true,
        text: lines(`📥 ${who} **joined the server.**`, timeBlock('Age of account', user.createdTimestamp)),
      }));

      let details;
      try {
        const invite = await findUsedInvite(guild);
        if (invite) {
          details = [label('Invite', `\`discord.gg/${invite.code}\``), label('Created by', invite.inviterId && `<@${invite.inviterId}>`), label('Uses', String(invite.uses))];
        } else if (guild.vanityURLCode) {
          details = label('Invite', `Probably the vanity link \`discord.gg/${guild.vanityURLCode}\``);
        } else {
          details = label('Invite', 'I couldn\'t tell which invite they used.');
        }
      } catch {
        details = label('Invite', 'Unknown: I need the **Manage Server** permission to see which invite they used.');
      }
      await sendLog(guild, 'invite', logEmbed('blue', { user, text: lines(`📨 ${who} **joined the server.**`, details) }));
    },
  },

  {
    name: Events.GuildMemberRemove,
    async execute(member) {
      const roles = member.partial ? 'Unknown' : member.roles.cache.filter((r) => r.id !== member.guild.id).map(String).join(' ') || 'None';
      // Same style: the sentence, then when they joined (= how long they were in the server), then their roles
      const joined = member.joinedTimestamp ? timeBlock('Joined', member.joinedTimestamp) : '⏲ **Joined:** Unknown';
      await sendLog(member.guild, 'left-server', logEmbed('red', {
        user: member.user, thumbnail: true,
        text: lines(`📤 <@${member.user.id}> **left the server.**`, joined, label('Roles', roles)),
      }));
    },
  },
];

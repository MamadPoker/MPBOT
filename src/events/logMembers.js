const { Events } = require('discord.js');
const { db } = require('../db');
const { logEmbed, label, lines, timeBlock, sendLog } = require('../logs');

// ---- Member snapshots: join date + roles of every member, saved in the database ----
const SYNC_GAP = 1_000; // pause between servers when loading all members, to go easy on Discord
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function saveMember(member) {
  const roles = member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => ({ id: r.id, name: r.name })); // without @everyone
  db.prepare(`
    INSERT INTO member_snapshots (guild_id, user_id, joined_at, roles, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET joined_at = excluded.joined_at, roles = excluded.roles, updated_at = excluded.updated_at
  `).run(member.guild.id, member.user.id, member.joinedTimestamp, JSON.stringify(roles), Date.now());
}

// Loads every member of one server (needs the Server Members intent) and saves them all.
// Members who left while the bot was off are removed. Errors/timeouts only skip this server.
async function syncMembers(guild) {
  const started = Date.now();
  try {
    const members = await guild.members.fetch();
    db.exec('BEGIN'); // one write for all members, much faster than one per member
    try {
      for (const member of members.values()) saveMember(member);
      db.prepare('DELETE FROM member_snapshots WHERE guild_id = ? AND updated_at < ?').run(guild.id, started);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(`Could not load the members of ${guild.name}:`, err.message);
  }
}

// One server after another, so a big server or a failure never blocks the others for long
async function syncAllMembers(client) {
  for (const [i, guild] of [...client.guilds.cache.values()].entries()) {
    if (i > 0) await sleep(SYNC_GAP);
    await syncMembers(guild);
  }
}

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
    execute: (client) => Promise.all([...client.guilds.cache.map(snapshot), syncAllMembers(client)]),
  },
  { name: Events.GuildCreate, execute: (guild) => Promise.all([snapshot(guild), syncMembers(guild)]) }, // bot added to a new server
  { name: Events.GuildMemberUpdate, execute: async (before, after) => saveMember(after) }, // e.g. roles changed (async: an error is logged, never a crash)
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
      saveMember(member);
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
      const { guild, user } = member;
      // Not in the bot's memory (partial)? Then use the saved snapshot. "Unknown" only if neither has it.
      const stored = member.partial
        ? db.prepare('SELECT joined_at, roles FROM member_snapshots WHERE guild_id = ? AND user_id = ?').get(guild.id, user.id)
        : null;
      const joinedAt = member.partial ? stored?.joined_at : member.joinedTimestamp;
      let roles = 'Unknown';
      if (!member.partial) roles = member.roles.cache.filter((r) => r.id !== guild.id).map(String).join(' ') || 'None';
      else if (stored) {
        // A role deleted since then can't be mentioned anymore, so its saved name instead
        roles = JSON.parse(stored.roles).map((r) => (guild.roles.cache.has(r.id) ? `<@&${r.id}>` : `@${r.name} (deleted)`)).join(' ') || 'None';
      }
      // Same style: the sentence, then when they joined (= how long they were in the server), then their roles
      const joined = joinedAt ? timeBlock('Joined', joinedAt) : '⏲ **Joined:** Unknown';
      await sendLog(guild, 'left-server', logEmbed('red', {
        user, thumbnail: true,
        text: lines(`📤 <@${user.id}> **left the server.**`, joined, label('Roles', roles)),
      }));
      db.prepare('DELETE FROM member_snapshots WHERE guild_id = ? AND user_id = ?').run(guild.id, user.id);
    },
  },
];

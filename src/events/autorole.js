const { Events } = require('discord.js');
const { getSetting } = require('../db');

async function giveAutoRole(member) {
  const roleId = getSetting(member.guild.id, 'autorole');
  if (!roleId || member.user.bot) return; // bots don't get the member role
  await member.roles.add(roleId, 'Auto-role').catch((err) =>
    console.error(`Could not give auto-role in ${member.guild.name}:`, err.message),
  );
}

module.exports = [
  {
    name: Events.GuildMemberAdd,
    async execute(member) {
      // If the server has rules screening, wait until the member accepts the rules (event below)
      if (!member.pending) await giveAutoRole(member);
    },
  },
  {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
      if (oldMember.pending && !newMember.pending) await giveAutoRole(newMember);
    },
  },
];

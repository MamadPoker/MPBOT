const { Events } = require('discord.js');
const { checkAutomod } = require('../automod');
const { giveXp } = require('../leveling');

module.exports = [
  {
    name: Events.MessageCreate,
    async execute(message) {
      if (!message.guild || message.author.bot || message.system) return;
      if (await checkAutomod(message)) return; // removed messages don't earn XP
      await giveXp(message);
    },
  },
  {
    // Check edited messages too, so nobody can sneak a bad word in afterwards
    name: Events.MessageUpdate,
    async execute(before, after) {
      if (!after.guild || !after.author || after.author.bot || before.content === after.content) return;
      await checkAutomod(after);
    },
  },
];

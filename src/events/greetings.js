const { Events } = require('discord.js');
const { sendGreeting } = require('../greetings');

const greetOn = (name, type) => ({
  name,
  async execute(member) {
    await sendGreeting(type, member).catch((err) =>
      console.error(`Could not send ${type} message in ${member.guild.name}:`, err.message),
    );
  },
});

module.exports = [greetOn(Events.GuildMemberAdd, 'welcome'), greetOn(Events.GuildMemberRemove, 'goodbye')];

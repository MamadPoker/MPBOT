const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    // Register all slash commands globally, so they work in every server the bot joins
    await client.application.commands.set(client.commands.map((c) => c.data.toJSON()));
    console.log(`Logged in as ${client.user.tag}. ${client.commands.size} command(s) registered.`);
  },
};

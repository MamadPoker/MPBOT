const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is alive'),
  async execute(interaction) {
    // WebSocket ping = heartbeat round trip to Discord, so it doesn't depend on this computer's clock.
    // It's -1 until Discord answers the first heartbeat (up to ~40s after startup).
    const ping = interaction.client.ws.ping;
    await interaction.reply(`🏓 Pong! WebSocket ping: ${ping >= 0 ? `${Math.round(ping)}ms` : 'measuring...'}`);
  },
};

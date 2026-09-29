const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is alive'),
  async execute(interaction) {
    await interaction.reply(`🏓 Pong! (${Date.now() - interaction.createdTimestamp}ms)`);
  },
};

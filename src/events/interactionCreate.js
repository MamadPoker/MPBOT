const { Events, MessageFlags } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Autocomplete goes to the command's autocomplete(); menus/buttons with customId "command:..." go to its handleComponent()
    if (interaction.isAutocomplete() || interaction.isMessageComponent()) {
      const name = interaction.isAutocomplete() ? interaction.commandName : interaction.customId.split(':')[0];
      const command = interaction.client.commands.get(name);
      const handler = interaction.isAutocomplete() ? command?.autocomplete : command?.handleComponent;
      try {
        await handler?.(interaction);
      } catch (err) {
        console.error(`Error in /${name} (${interaction.isAutocomplete() ? 'autocomplete' : 'menu'}):`, err);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const content = `❌ Something went wrong: ${err.message}`;
      // Replace the "thinking..." message if there is one, otherwise answer normally
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};

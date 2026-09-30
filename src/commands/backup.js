const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { makeBackup, sendBackupToOwner } = require('../backup');
const { refuseNonOwner } = require('../owner');

module.exports = {
  ownerOnly: true, // only the bot owner (OWNER_ID in .env) can use it; /help only shows it to them
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Back up the database now and DM it to the bot owner')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // hidden from non-admins in servers
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM), // also works in your DM with the bot

  async execute(interaction) {
    if (await refuseNonOwner(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const file = makeBackup();
    const dmError = await sendBackupToOwner(interaction.client, file).then(() => null, (err) => err.message);
    return interaction.editReply(dmError
      ? `⚠️ Backup saved as \`backups/${path.basename(file)}\`, but I couldn't DM it to you: ${dmError}`
      : `✅ Backup saved as \`backups/${path.basename(file)}\` and sent to your DMs.`);
  },
};

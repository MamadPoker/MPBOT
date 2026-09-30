const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { makeBackup, sendBackupToOwner } = require('../backup');

module.exports = {
  ownerOnly: true, // only the bot owner (OWNER_ID in .env) can use it; /help only shows it to them
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Back up the database now and DM it to the bot owner')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // hidden from everyone but admins
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!process.env.OWNER_ID || interaction.user.id !== process.env.OWNER_ID) {
      const hint = process.env.OWNER_ID ? '' : ' (OWNER_ID isn\'t set in the bot\'s .env file yet)';
      return interaction.reply({ content: `❌ Only the bot owner can use this.${hint}`, flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const file = makeBackup();
    const dmError = await sendBackupToOwner(interaction.client, file).then(() => null, (err) => err.message);
    return interaction.editReply(dmError
      ? `⚠️ Backup saved as \`backups/${path.basename(file)}\`, but I couldn't DM it to you: ${dmError}`
      : `✅ Backup saved as \`backups/${path.basename(file)}\` and sent to your DMs.`);
  },
};

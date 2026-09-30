const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, InteractionContextType, MessageFlags, escapeMarkdown,
} = require('discord.js');
const { refuseNonOwner } = require('../owner');

const PAGE_SIZE = 10;

// One page of the server list (newest first), with Previous/Next buttons if there's more than one page
async function listPage(client, page) {
  const guilds = [...client.guilds.cache.values()].sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);
  const pages = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const lines = await Promise.all(guilds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(async (g, i) => {
    const owner = await client.users.fetch(g.ownerId).catch(() => null);
    return [
      `**${page * PAGE_SIZE + i + 1}. ${escapeMarkdown(g.name)}**`,
      `ID: \`${g.id}\` · 👥 ${g.memberCount} members · 👑 ${owner ? escapeMarkdown(owner.username) : g.ownerId} · 📅 joined <t:${Math.floor(g.joinedTimestamp / 1000)}:D>`,
    ].join('\n');
  }));
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`MP Bot is in ${guilds.length} server${guilds.length === 1 ? '' : 's'}`)
    .setDescription(lines.join('\n\n') || 'No servers.')
    .setFooter({ text: `Page ${page + 1}/${pages}` });
  const button = (label, target, disabled) =>
    new ButtonBuilder().setCustomId(`servers:page:${target}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const components = pages > 1
    ? [new ActionRowBuilder().addComponents(button('Previous', page - 1, page === 0), button('Next', page + 1, page === pages - 1))]
    : [];
  return { embeds: [embed], components };
}

module.exports = {
  ownerOnly: true, // only the bot owner (OWNER_ID in .env); /help only shows it to them
  data: new SlashCommandBuilder()
    .setName('servers')
    .setDescription('See and manage the servers MP Bot is in')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // hidden from non-admins in servers
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM) // also works in your DM with the bot
    .addSubcommand((s) => s.setName('list').setDescription('List every server MP Bot is in'))
    .addSubcommand((s) =>
      s.setName('leave').setDescription('Make MP Bot leave a server (asks you to confirm first)')
        .addStringOption((o) => o.setName('server_id').setDescription('ID of the server (see /servers list)').setRequired(true)),
    ),

  async execute(interaction) {
    if (await refuseNonOwner(interaction)) return;
    const { client } = interaction;

    if (interaction.options.getSubcommand() === 'list') {
      return interaction.reply({ ...(await listPage(client, 0)), flags: MessageFlags.Ephemeral });
    }

    const id = interaction.options.getString('server_id').trim();
    const guild = client.guilds.cache.get(id);
    if (!guild) {
      return interaction.reply({ content: `❌ MP Bot isn't in a server with ID \`${id}\`. See \`/servers list\`.`, flags: MessageFlags.Ephemeral });
    }
    const confirm = new ButtonBuilder().setCustomId(`servers:leave:${guild.id}`).setLabel('Confirm').setStyle(ButtonStyle.Danger);
    const cancel = new ButtonBuilder().setCustomId('servers:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
    return interaction.reply({
      content: `Leave **${escapeMarkdown(guild.name)}** (\`${guild.id}\`, ${guild.memberCount} members)? MP Bot will be removed from that server.`,
      components: [new ActionRowBuilder().addComponents(confirm, cancel)],
      flags: MessageFlags.Ephemeral,
    });
  },

  // Buttons: "servers:page:<n>", "servers:leave:<id>", "servers:cancel"
  async handleComponent(interaction) {
    if (await refuseNonOwner(interaction)) return;
    const [, action, value] = interaction.customId.split(':');
    if (action === 'page') return interaction.update(await listPage(interaction.client, Number(value)));
    if (action === 'cancel') return interaction.update({ content: 'Cancelled. MP Bot stays in that server.', components: [] });
    if (action === 'leave') {
      const guild = interaction.client.guilds.cache.get(value);
      if (!guild) return interaction.update({ content: 'MP Bot is already not in that server.', components: [] });
      await guild.leave();
      return interaction.update({ content: `✅ MP Bot left **${escapeMarkdown(guild.name)}**.`, components: [] });
    }
  },
};

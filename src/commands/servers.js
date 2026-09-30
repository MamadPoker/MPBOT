const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  PermissionFlagsBits, InteractionContextType, MessageFlags, escapeMarkdown,
} = require('discord.js');
const { getSetting } = require('../db');
const { LOG_TYPES } = require('../logs');
const { PLATFORMS, ALERT_CHANNEL, followed } = require('../live');
const { refuseNonOwner } = require('../owner');

const PAGE_SIZE = 10;
const COLOR = 0x5865f2;
const EXPIRED = 'This menu expired, run /servers list again.';

// Every button/dropdown carries what it needs in its ID ("servers:<action>:<server id or ->:<page>"),
// so they keep working after a restart; nothing is kept in memory.
const id = (action, serverId, page) => `servers:${action}:${serverId ?? '-'}:${page}`;
const button = (action, serverId, page, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id(action, serverId, page)).setLabel(label).setStyle(style);

const nameOf = (guild) => (guild.name ? escapeMarkdown(guild.name) : '*(unavailable)*');
const when = (ms) => `<t:${Math.floor(ms / 1000)}:D> (<t:${Math.floor(ms / 1000)}:R>)`;
const sortedGuilds = (client) => [...client.guilds.cache.values()].sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);

// ---- Overview: one line per server, 10 per page, dropdown to open a server ----
function listView(client, page, note = '') {
  const guilds = sortedGuilds(client);
  const pages = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
  page = Math.min(Math.max(page || 0, 0), pages - 1);
  const shown = guilds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const total = guilds.reduce((sum, g) => sum + (g.memberCount ?? 0), 0);
  const lines = shown.map((g, i) =>
    `**${page * PAGE_SIZE + i + 1}.** ${nameOf(g)} — 👥 ${g.memberCount ?? '?'} · joined <t:${Math.floor(g.joinedTimestamp / 1000)}:R>`);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`MP Bot — ${guilds.length} server${guilds.length === 1 ? '' : 's'}`)
    .setDescription([`👥 **${total.toLocaleString('en-US')} members** in total`, '', ...lines].join('\n'))
    .setFooter({ text: `Page ${page + 1}/${pages} • Updated just now` })
    .setTimestamp();

  const components = [];
  if (shown.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(id('pick', null, page))
        .setPlaceholder('Pick a server to see its details')
        .addOptions(shown.map((g) => ({ label: (g.name ?? g.id).slice(0, 100), value: g.id, description: `${g.memberCount ?? '?'} members` }))),
    ));
  }
  if (pages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      button('list', null, page - 1, 'Previous').setDisabled(page === 0),
      button('list', null, page + 1, 'Next').setDisabled(page === pages - 1),
    ));
  }
  return { content: note, embeds: [embed], components };
}

// Which MP Bot features are set up in this server
function features(guildId) {
  const on = (key) => Boolean(getSetting(guildId, key));
  const logs = LOG_TYPES.filter((t) => on(`log:${t}`)).length;
  const live = followed(guildId).map((r) => `${PLATFORMS[r.platform].label}: ${r.name}`);
  const line = (ok, label) => `${ok ? '✅' : '❌'} ${label}`;
  return [
    line(logs > 0, `Logs${logs ? ` (${logs}/${LOG_TYPES.length} channels)` : ''}`),
    line(on(ALERT_CHANNEL) && live.length > 0, `Live alerts${live.length ? ` (${live.join(', ')})` : ''}`),
    line(on('welcome_channel'), 'Welcome'),
    line(on('goodbye_channel'), 'Goodbye'),
    line(on('autorole'), 'Auto-role'),
    line(on('leveling_enabled'), 'Leveling'),
    line(on('automod_enabled'), 'Auto-mod'),
  ].join('\n');
}

async function card(client, guild) {
  const owner = await client.users.fetch(guild.ownerId).catch(() => null);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(guild.name ?? guild.id)
    .setThumbnail(guild.iconURL?.({ size: 256 }) ?? null)
    .addFields(
      { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
      { name: 'Owner', value: `<@${guild.ownerId}>${owner ? ` (${escapeMarkdown(owner.username)})` : ''}`, inline: true },
      { name: 'Members', value: `${guild.memberCount ?? '?'}`, inline: true },
      { name: 'Channels', value: `${guild.channels?.cache.size ?? '?'}`, inline: true },
      { name: 'Roles', value: `${guild.roles ? guild.roles.cache.size - 1 : '?'}`, inline: true }, // without @everyone
      { name: '​', value: '​', inline: true },
      { name: 'Created on', value: when(guild.createdTimestamp), inline: true },
      { name: 'MP Bot joined on', value: when(guild.joinedTimestamp), inline: true },
      { name: 'MP Bot features', value: features(guild.id) },
    )
    .setFooter({ text: 'Updated just now' })
    .setTimestamp();
}

const gone = (client, page) => listView(client, page, '⚠️ MP Bot is no longer in that server.');

// ---- Server detail card with Back / Refresh / Leave ----
async function detailView(client, serverId, page) {
  const guild = client.guilds.cache.get(serverId);
  if (!guild) return gone(client, page);
  return {
    content: '',
    embeds: [await card(client, guild)],
    components: [new ActionRowBuilder().addComponents(
      button('list', null, page, '⬅ Back'),
      button('detail', serverId, page, '🔄 Refresh'),
      button('ask', serverId, page, 'Leave server', ButtonStyle.Danger),
    )],
  };
}

// ---- "Are you sure?" before leaving ----
async function confirmView(client, serverId, page) {
  const guild = client.guilds.cache.get(serverId);
  if (!guild) return gone(client, page);
  return {
    content: `Leave **${nameOf(guild)}** (\`${guild.id}\`, ${guild.memberCount} members)? MP Bot will be removed from that server.`,
    embeds: [await card(client, guild)],
    components: [new ActionRowBuilder().addComponents(
      button('leave', serverId, page, 'Yes, leave', ButtonStyle.Danger),
      button('detail', serverId, page, 'Cancel'),
    )],
  };
}

async function leaveView(client, serverId, page) {
  const guild = client.guilds.cache.get(serverId);
  if (!guild) return listView(client, page, 'MP Bot is already not in that server.');
  await guild.leave();
  return listView(client, page, `✅ Left **${nameOf(guild)}**.`);
}

const VIEWS = {
  list: (client, serverId, page) => listView(client, page),
  pick: (client, serverId, page, interaction) => detailView(client, interaction.values[0], page),
  detail: detailView,
  ask: confirmView,
  leave: leaveView,
};

module.exports = {
  ownerOnly: true, // only the bot owner (OWNER_ID in .env); /help only shows it to them
  data: new SlashCommandBuilder()
    .setName('servers')
    .setDescription('See and manage the servers MP Bot is in')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // hidden from non-admins in servers
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM) // also works in your DM with the bot
    .addSubcommand((s) => s.setName('list').setDescription('Every server MP Bot is in, with details and a leave button'))
    .addSubcommand((s) =>
      s.setName('leave').setDescription('Make MP Bot leave a server (asks you to confirm first)')
        .addStringOption((o) => o.setName('server_id').setDescription('ID of the server (see /servers list)').setRequired(true)),
    ),

  async execute(interaction) {
    if (await refuseNonOwner(interaction)) return;
    const { client } = interaction;
    if (interaction.options.getSubcommand() === 'list') {
      return interaction.reply({ ...listView(client, 0), flags: MessageFlags.Ephemeral });
    }
    const serverId = interaction.options.getString('server_id').trim();
    if (!client.guilds.cache.has(serverId)) {
      return interaction.reply({ content: `❌ MP Bot isn't in a server with ID \`${serverId}\`. See \`/servers list\`.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...(await confirmView(client, serverId, 0)), flags: MessageFlags.Ephemeral });
  },

  // Buttons and the dropdown
  async handleComponent(interaction) {
    if (await refuseNonOwner(interaction)) return;
    const [, action, serverId, page] = interaction.customId.split(':');
    const view = VIEWS[action];
    if (!view) return interaction.reply({ content: EXPIRED, flags: MessageFlags.Ephemeral }); // e.g. a menu from an older version
    try {
      await interaction.deferUpdate(); // answer Discord within its 3-second limit, then do the (slower) work
      await interaction.editReply(await view(interaction.client, serverId === '-' ? null : serverId, Number(page) || 0, interaction));
    } catch (err) {
      console.error('/servers menu error:', err.message);
      await interaction.followUp({ content: EXPIRED, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};

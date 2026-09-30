const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags } = require('discord.js');
const { db, getSetting, setSetting } = require('../db');
const { fetchKickChannel, parseSlug, roleMention } = require('../kick');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Kick live alerts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('add').setDescription('Get alerts when a Kick channel goes live')
        .addStringOption((o) => o.setName('channel').setDescription('Kick username or link, e.g. mamadpoker').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Stop alerts for a Kick channel')
        .addStringOption((o) => o.setName('channel').setDescription('Kick username').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('set-channel').setDescription('Choose where live alerts are posted')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for alerts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('set-role').setDescription('Role to ping with alerts (leave empty for no ping)')
        .addRoleOption((o) => o.setName('role').setDescription('Role to ping')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show the current live alert settings')),

  async execute(interaction) {
    const guildId = interaction.guildId;
    // Settings replies are only visible to the admin, and never ping anyone
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // asking Kick can take a few seconds
        const channel = await fetchKickChannel(parseSlug(interaction.options.getString('channel')));
        if (!channel) return interaction.editReply('❌ That Kick channel doesn\'t exist. Check the spelling.');
        db.prepare('INSERT OR IGNORE INTO kick_channels (guild_id, slug) VALUES (?, ?)').run(guildId, channel.slug);
        const warning = getSetting(guildId, 'kick_alert_channel') ? '' : '\n⚠️ Now choose where alerts go with `/live set-channel`.';
        return interaction.editReply(`✅ Watching **${channel.user.username}** (kick.com/${channel.slug}).${warning}`);
      }

      case 'remove': {
        const slug = parseSlug(interaction.options.getString('channel'));
        const { changes } = db.prepare('DELETE FROM kick_channels WHERE guild_id = ? AND slug = ?').run(guildId, slug);
        return reply(changes ? `✅ Stopped alerts for **${slug}**.` : `❌ **${slug}** isn't on the list. See \`/live list\`.`);
      }

      case 'set-channel': {
        const channel = interaction.options.getChannel('channel');
        setSetting(guildId, 'kick_alert_channel', channel.id);
        const canSend = channel.permissionsFor(interaction.guild.members.me).has(['ViewChannel', 'SendMessages', 'EmbedLinks']);
        const warning = canSend ? '' : '\n⚠️ I don\'t have permission to send embeds there. Check the channel permissions.';
        return reply(`✅ Live alerts will be posted in ${channel}.${warning}`);
      }

      case 'set-role': {
        const role = interaction.options.getRole('role');
        setSetting(guildId, 'kick_role', role?.id);
        return reply(role ? `✅ Alerts will ping ${roleMention(guildId, role.id)}.` : '✅ Alerts won\'t ping any role.');
      }

      case 'list': {
        const slugs = db.prepare('SELECT slug FROM kick_channels WHERE guild_id = ?').all(guildId).map((r) => r.slug);
        const alertChannel = getSetting(guildId, 'kick_alert_channel');
        return reply([
          `**Alert channel:** ${alertChannel ? `<#${alertChannel}>` : 'not set'}`,
          `**Ping role:** ${roleMention(guildId, getSetting(guildId, 'kick_role')) || 'none'}`,
          `**Kick channels:** ${slugs.join(', ') || 'none'}`,
        ].join('\n'));
      }
    }
  },
};

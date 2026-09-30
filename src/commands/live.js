const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags } = require('discord.js');
const { db, getSetting, setSetting } = require('../db');
const { PLATFORMS, ALERT_CHANNEL, PING_ROLE, platformOfLink, parseChannel, roleMention, followed } = require('../live');

const TWITCH_KEYS_MISSING = '❌ Twitch alerts need a free Twitch developer app first: add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET '
  + 'to the bot\'s .env file (see the README), then restart the bot.';
const shownAs = (row) => `${PLATFORMS[row.platform].icon} ${PLATFORMS[row.platform].label}: ${row.name}`;

// /live remove: find the followed channel from an autocomplete pick ("twitch:12345"), a link or a name
async function findFollowed(guildId, input) {
  const rows = followed(guildId);
  const picked = rows.filter((r) => `${r.platform}:${r.channel_id}` === input);
  if (picked.length) return picked;
  const linkPlatform = platformOfLink(input);
  const parsed = linkPlatform && parseChannel(linkPlatform, input);
  if (parsed?.error) return parsed;
  const wanted = (parsed?.ref.value ?? input.replace(/^@/, '')).toLowerCase();
  const matches = rows.filter((r) => (!linkPlatform || r.platform === linkPlatform)
    && [r.channel_id.toLowerCase(), r.name.toLowerCase().replace(/^@/, '')].includes(wanted));
  // A YouTube @handle link: look up its channel ID
  if (!matches.length && linkPlatform === 'youtube' && parsed.ref.kind !== 'id') {
    const found = await PLATFORMS.youtube.resolve(parsed.ref).catch(() => null);
    return rows.filter((r) => r.platform === 'youtube' && r.channel_id === found?.channelId);
  }
  return matches;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Live alerts for Kick, Twitch and YouTube')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('add').setDescription('Get an alert when a Kick, Twitch or YouTube channel goes live')
        .addStringOption((o) =>
          o.setName('platform').setDescription('Where the channel streams').setRequired(true)
            .addChoices(...Object.values(PLATFORMS).map((p) => ({ name: p.label, value: p.id }))),
        )
        .addStringOption((o) => o.setName('channel').setDescription('Channel name or link, e.g. xqc, @mrbeast or twitch.tv/xqc').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Stop alerts for a channel')
        .addStringOption((o) => o.setName('channel').setDescription('Pick from the list, or paste a link').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s.setName('set-channel').setDescription('Choose where live alerts are posted (all platforms)')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel for alerts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('set-role').setDescription('Role to ping with alerts (leave empty for no ping)')
        .addRoleOption((o) => o.setName('role').setDescription('Role to ping')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show followed channels and the alert settings')),

  async execute(interaction) {
    const guildId = interaction.guildId;
    // Settings replies are only visible to the admin, and never ping anyone
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        const platform = PLATFORMS[interaction.options.getString('platform')];
        const parsed = parseChannel(platform.id, interaction.options.getString('channel'));
        if (parsed.error) return reply(parsed.error);
        if (platform.hasKeys && !platform.hasKeys()) return reply(TWITCH_KEYS_MISSING);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // asking the platform can take a few seconds
        let found;
        try {
          found = await platform.resolve(parsed.ref);
        } catch (err) {
          return interaction.editReply(`❌ Couldn't check that ${platform.label} channel right now (${err.message}). Please try again in a minute.`);
        }
        if (!found) return interaction.editReply(`❌ There's no ${platform.label} channel called "${parsed.shown}". Check the spelling or the link.`);

        const { changes } = db.prepare('INSERT OR IGNORE INTO live_channels (guild_id, platform, channel_id, name) VALUES (?, ?, ?, ?)')
          .run(guildId, platform.id, found.channelId, found.name);
        if (!changes) return interaction.editReply(`ℹ️ Already following ${platform.label}: ${found.name}`);
        const warning = getSetting(guildId, ALERT_CHANNEL) ? '' : '\n⚠️ Now choose where alerts go with `/live set-channel`.';
        return interaction.editReply(`✅ Following ${platform.label}: ${found.name}${warning}`);
      }

      case 'remove': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // a YouTube link may need a quick lookup
        const matches = await findFollowed(guildId, interaction.options.getString('channel').trim());
        if (matches.error) return interaction.editReply(matches.error);
        if (!matches.length) return interaction.editReply('❌ You don\'t follow that channel. See `/live list`.');
        if (matches.length > 1) {
          return interaction.editReply(`❌ That name matches several channels (${matches.map(shownAs).join(', ')}). Pick the one to remove from the list.`);
        }
        const [row] = matches;
        db.prepare('DELETE FROM live_channels WHERE guild_id = ? AND platform = ? AND channel_id = ?').run(guildId, row.platform, row.channel_id);
        return interaction.editReply(`✅ Stopped alerts for ${PLATFORMS[row.platform].label}: ${row.name}`);
      }

      case 'set-channel': {
        const channel = interaction.options.getChannel('channel');
        setSetting(guildId, ALERT_CHANNEL, channel.id);
        const canSend = channel.permissionsFor(interaction.guild.members.me).has(['ViewChannel', 'SendMessages', 'EmbedLinks']);
        const warning = canSend ? '' : '\n⚠️ I don\'t have permission to send embeds there. Check the channel permissions.';
        return reply(`✅ Live alerts (Kick, Twitch and YouTube) will be posted in ${channel}.${warning}`);
      }

      case 'set-role': {
        const role = interaction.options.getRole('role');
        setSetting(guildId, PING_ROLE, role?.id);
        return reply(role ? `✅ Alerts will ping ${roleMention(guildId, role.id)}.` : '✅ Alerts won\'t ping any role.');
      }

      case 'list': {
        const rows = followed(guildId);
        const alertChannel = getSetting(guildId, ALERT_CHANNEL);
        return reply([
          `**Alert channel:** ${alertChannel ? `<#${alertChannel}>` : 'not set'}`,
          `**Ping role:** ${roleMention(guildId, getSetting(guildId, PING_ROLE)) || 'none'}`,
          `**Followed channels:**${rows.length ? '' : ' none'}`,
          ...rows.map(shownAs),
        ].join('\n'));
      }
    }
  },

  // /live remove: suggest the followed channels, with their platform
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const rows = followed(interaction.guildId).filter((r) => `${r.platform} ${r.name} ${r.channel_id}`.toLowerCase().includes(typed));
    await interaction.respond(rows.slice(0, 25).map((r) => ({ name: shownAs(r).slice(0, 100), value: `${r.platform}:${r.channel_id}` })));
  },
};

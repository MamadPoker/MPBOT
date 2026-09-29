const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType, InteractionContextType, MessageFlags } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { LOG_TYPES, simplifyName } = require('../logs');

// Permissions the bot needs for logging, and what breaks without them
const NEEDED = [
  [P.ViewAuditLog, 'View Audit Log', 'kick/ban/unban/timeout/nickname/role/channel logs'],
  [P.ManageGuild, 'Manage Server', 'invite tracking'],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('log')
    .setDescription('Server logs, one channel per event type')
    .setDefaultMemberPermissions(P.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('Choose the channel for one log type')
        .addStringOption((o) =>
          o.setName('event').setDescription('Log type').setRequired(true)
            .addChoices(...LOG_TYPES.map((t) => ({ name: t, value: t }))),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to log it (leave empty to turn this log off)').addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) => s.setName('setup').setDescription('Link log channels by name, and create missing ones in a private "LOGs" category'))
    .addSubcommand((s) => s.setName('list').setDescription('Show which channel each log goes to')),

  async execute(interaction) {
    const { guild } = interaction;
    const me = guild.members.me;
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const missingPerms = NEEDED.filter(([perm]) => !me.permissions.has(perm))
      .map(([, name, what]) => `\n⚠️ I need **${name}** for ${what}.`).join('');

    switch (interaction.options.getSubcommand()) {
      case 'set': {
        const type = interaction.options.getString('event');
        const channel = interaction.options.getChannel('channel');
        setSetting(guild.id, `log:${type}`, channel?.id);
        if (!channel) return reply(`✅ \`${type}\` logging is off.`);
        const canSend = channel.permissionsFor(me).has([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
        const warning = canSend ? '' : '\n⚠️ I can\'t post there yet. Give me View Channel, Send Messages and Embed Links in that channel.';
        return reply(`✅ \`${type}\` logs will go to ${channel}.${warning}${missingPerms}`);
      }

      case 'setup': {
        if (!me.permissions.has(P.ManageChannels)) return reply('❌ I need the **Manage Channels** permission to create log channels.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // creating channels takes a while

        const channels = await guild.channels.fetch();
        let category = channels.find((c) => c.type === ChannelType.GuildCategory && simplifyName(c.name) === 'logs');
        let linked = 0;
        let created = 0;
        const visibleToAll = [];

        for (const type of LOG_TYPES) {
          const matches = channels.filter((c) => c.type === ChannelType.GuildText && simplifyName(c.name) === simplifyName(type));
          let channel = matches.find((c) => c.parentId === category?.id) ?? matches.first(); // prefer the one inside LOGs
          if (channel) {
            linked++;
          } else {
            // Private category: logs include deleted messages, so only admins (and the bot) should see them
            category ??= await guild.channels.create({
              name: 'LOGs',
              type: ChannelType.GuildCategory,
              permissionOverwrites: [
                { id: guild.roles.everyone, deny: [P.ViewChannel] },
                { id: me, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
              ],
            });
            channel = await guild.channels.create({ name: type, parent: category, permissionOverwrites: category.permissionOverwrites.cache });
            created++;
          }
          if (channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel)) visibleToAll.push(`${channel}`);
          setSetting(guild.id, `log:${type}`, channel.id);
        }

        const publicWarning = visibleToAll.length
          ? `\n⚠️ Everyone can see these log channels: ${visibleToAll.join(' ')}. Consider making them private.`
          : '';
        return interaction.editReply(
          `✅ All ${LOG_TYPES.length} logs are set up: ${linked} existing channel(s) linked, ${created} created in **LOGs**.${publicWarning}${missingPerms}`,
        );
      }

      case 'list': {
        const lines = LOG_TYPES.map((type) => {
          const id = getSetting(guild.id, `log:${type}`);
          return `\`${type}\` → ${id ? `<#${id}>` : '*off*'}`;
        });
        return reply(lines.join('\n') + missingPerms);
      }
    }
  },
};

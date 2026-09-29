const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, InteractionContextType, MessageFlags } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { DEFAULT_MESSAGES, formatGreeting, sendGreeting } = require('../greetings');
const { renderWelcomeCard, prepareBackground } = require('../welcomeCard');

// Builds two commands: /welcome and /goodbye (welcome also has the image card)
module.exports = ['welcome', 'goodbye'].map((type) => {
  const Type = type === 'welcome' ? 'Welcome' : 'Goodbye';
  const data = new SlashCommandBuilder()
    .setName(type)
    .setDescription(`${Type} messages`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('set-channel').setDescription(`Channel for ${type} messages`)
        .addChannelOption((o) =>
          o.setName('channel').setDescription(`Where ${type} messages are posted`)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('set-message').setDescription(`Change the ${type} text (leave empty to reset to default)`)
        .addStringOption((o) =>
          o.setName('message').setDescription('Use {user} {username} {server} {count}, and \\n for a new line').setMaxLength(1500),
        ),
    )
    .addSubcommand((s) => s.setName('test').setDescription(`Send a test ${type} message about yourself`))
    .addSubcommand((s) => s.setName('disable').setDescription(`Turn off ${type} messages`));

  if (type === 'welcome') {
    data.addSubcommand((s) =>
      s.setName('set-background').setDescription('Custom welcome card background (leave empty to use the blurred avatar)')
        .addAttachmentOption((o) => o.setName('image').setDescription('PNG or JPG, ideally 1024x450')),
    );
  }

  return {
    data,
    async execute(interaction) {
      const guildId = interaction.guildId;
      const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

      switch (interaction.options.getSubcommand()) {
        case 'set-channel': {
          const channel = interaction.options.getChannel('channel');
          setSetting(guildId, `${type}_channel`, channel.id);
          const needed = type === 'welcome' ? ['ViewChannel', 'SendMessages', 'AttachFiles'] : ['ViewChannel', 'SendMessages'];
          const canSend = channel.permissionsFor(interaction.guild.members.me).has(needed);
          const warning = canSend ? '' : `\n⚠️ I'm missing permissions there. I need: ${needed.join(', ')}.`;
          return reply(`✅ ${Type} messages will be posted in ${channel}.${warning}`);
        }

        case 'set-message': {
          const message = interaction.options.getString('message');
          setSetting(guildId, `${type}_message`, message);
          const preview = formatGreeting(message ?? DEFAULT_MESSAGES[type], interaction.member);
          return reply(`✅ ${message ? 'Message saved' : 'Reset to the default message'}. Preview:\n\n${preview}`);
        }

        case 'set-background': {
          const image = interaction.options.getAttachment('image');
          if (!image) {
            setSetting(guildId, 'welcome_background', null);
            return reply('✅ Background reset: the card now uses each member\'s blurred avatar.');
          }
          if (!image.contentType?.startsWith('image/')) return reply('❌ That file isn\'t an image. Upload a PNG or JPG.');
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // image work can take a few seconds
          setSetting(guildId, 'welcome_background', await prepareBackground(image.url));
          return interaction.editReply({ content: '✅ Background saved. Preview:', files: [await renderWelcomeCard(interaction.member)] });
        }

        case 'test': {
          const sent = await sendGreeting(type, interaction.member).catch((err) => err);
          if (sent instanceof Error) return reply(`❌ Couldn't send the message: ${sent.message}`);
          const channelId = getSetting(guildId, `${type}_channel`);
          return reply(sent ? `✅ Test message sent to <#${channelId}>.` : `❌ Set a channel first with \`/${type} set-channel\`.`);
        }

        case 'disable':
          setSetting(guildId, `${type}_channel`, null);
          return reply(`✅ ${Type} messages are off. Use \`/${type} set-channel\` to turn them back on.`);
      }
    },
  };
});

const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { auditReason, logEmbed, label, moderatorLine, lines, sendLog } = require('../logs');

const TIMEOUTS = [
  ['Remove timeout', 0],
  ['60 seconds', 60_000],
  ['5 minutes', 5 * 60_000],
  ['10 minutes', 10 * 60_000],
  ['1 hour', 60 * 60_000],
  ['1 day', 24 * 60 * 60_000],
  ['1 week', 7 * 24 * 60 * 60_000],
];

// Safety checks before ban/kick/timeout. Returns an error message, or null if it's OK.
function checkTarget(interaction, user, member) {
  const { guild } = interaction;
  const me = guild.members.me;
  if (user.id === interaction.user.id) return '❌ You can\'t do that to yourself.';
  if (user.id === me.id) return '❌ I can\'t do that to myself.';
  if (!member) return null; // not in the server (only /ban allows that)
  if (member.id === guild.ownerId) return '❌ You can\'t do that to the server owner.';
  // Same rule Discord uses: you can only act on members whose top role is below yours
  if (interaction.user.id !== guild.ownerId && member.roles.highest.position >= interaction.member.roles.highest.position) {
    return '❌ That member\'s role is equal to or higher than yours.';
  }
  if (member.roles.highest.position >= me.roles.highest.position) {
    return `❌ That member's role is equal to or higher than mine. Drag my role (**${me.roles.highest.name}**) higher in Server Settings → Roles.`;
  }
  return null;
}

// Sent before the action: after a ban/kick we no longer share a server, so we can't DM them
const dm = (user, text) => user.send(text).catch(() => {}); // fails if they have DMs off, that's fine

const baseCommand = (name, description, permission) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(permission)
    .setContexts(InteractionContextType.Guild);

const reasonOption = (o) => o.setName('reason').setDescription('Why (shown in the logs and sent to the user)').setMaxLength(400);

// Runs the checks, then the action. Replies are visible to everyone in the channel, without pinging.
// The ban/kick/timeout logs are written by the audit log listener (events/logAudit.js).
// canDo(member) checks the bot's own permission first, so we never DM "you were banned" and then fail.
async function moderate(interaction, { needsMember, canDo, run }) {
  const user = interaction.options.getUser('user');
  const member = interaction.options.getMember('user');
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const error = needsMember && !member
    ? '❌ That user isn\'t in this server.'
    : checkTarget(interaction, user, member) ?? canDo(member);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const done = await run({ user, member, reason, auditReason: auditReason(interaction.user, reason) });
  return interaction.editReply({ content: done, allowedMentions: { parse: [] } });
}

module.exports = [
  {
    data: baseCommand('ban', 'Ban a user from the server', PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to ban').setRequired(true))
      .addStringOption(reasonOption)
      .addIntegerOption((o) =>
        o.setName('delete-messages').setDescription('Also delete their recent messages').addChoices(
          { name: 'Don\'t delete any', value: 0 },
          { name: 'Last hour', value: 3600 },
          { name: 'Last 24 hours', value: 86_400 },
          { name: 'Last 7 days', value: 604_800 },
        ),
      ),
    execute: (interaction) =>
      moderate(interaction, {
        needsMember: false, // you can ban someone who isn't in the server yet
        canDo: (member) =>
          (member ? member.bannable : interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))
            ? null
            : '❌ I need the **Ban Members** permission to do that.',
        async run({ user, reason, auditReason }) {
          await dm(user, `You were banned from **${interaction.guild.name}**.\nReason: ${reason}`);
          await interaction.guild.members.ban(user, {
            reason: auditReason,
            deleteMessageSeconds: interaction.options.getInteger('delete-messages') ?? 0,
          });
          return `🔨 **${user.username}** was banned. Reason: ${reason}`;
        },
      }),
  },

  {
    data: baseCommand('kick', 'Kick a member from the server', PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
      .addStringOption(reasonOption),
    execute: (interaction) =>
      moderate(interaction, {
        needsMember: true,
        canDo: (member) => (member.kickable ? null : '❌ I need the **Kick Members** permission to do that.'),
        async run({ user, member, reason, auditReason }) {
          await dm(user, `You were kicked from **${interaction.guild.name}**.\nReason: ${reason}`);
          await member.kick(auditReason);
          return `👢 **${user.username}** was kicked. Reason: ${reason}`;
        },
      }),
  },

  {
    data: baseCommand('timeout', 'Mute a member for a while (or remove their timeout)', PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('Who to time out').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('duration').setDescription('How long').setRequired(true)
          .addChoices(...TIMEOUTS.map(([name, value]) => ({ name, value }))),
      )
      .addStringOption(reasonOption),
    execute: (interaction) =>
      moderate(interaction, {
        needsMember: true,
        canDo: (member) =>
          member.moderatable ? null : '❌ I can\'t time out this member. Admins can\'t be timed out, and I need the **Timeout Members** permission.',
        async run({ user, member, reason, auditReason }) {
          const ms = interaction.options.getInteger('duration');
          if (ms === 0) {
            await member.timeout(null, auditReason);
            return `🔊 **${user.username}**'s timeout was removed.`;
          }
          const label = TIMEOUTS.find(([, value]) => value === ms)[0];
          await dm(user, `You were timed out in **${interaction.guild.name}** for ${label}.\nReason: ${reason}`);
          await member.timeout(ms, auditReason);
          return `🔇 **${user.username}** was timed out for ${label}. Reason: ${reason}`;
        },
      }),
  },

  {
    data: baseCommand('clear', 'Delete recent messages in this channel', PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName('amount').setDescription('How many messages (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user')),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter((m) => m.author.id === user.id);
      // `true` = skip messages older than 14 days (Discord doesn't allow bulk-deleting those)
      const deleted = await interaction.channel.bulkDelete(messages.first(amount), true);

      // Bulk deletes don't say who did it, so /clear writes its own log (including what was deleted)
      await sendLog(interaction.guild, 'message_deleted_logger', logEmbed('red', {
        user: user ?? interaction.user, // whose messages were cleared, or the moderator if it was everyone's
        text: lines(
          `🧹 **${deleted.size} message(s) cleared in** <#${interaction.channelId}>.`,
          label('From', user && `<@${user.id}>`),
          moderatorLine(interaction.user.id),
          label('Content', deleted.reverse().map((m) => `**${m.author.username}:** ${m.content || '*No text*'}`).join('\n').slice(0, 3000)),
        ),
      }));
      const note = deleted.size < amount ? '\n(Fewer than you asked for: there weren\'t that many, or some are older than 14 days.)' : '';
      return interaction.editReply(`🧹 Deleted ${deleted.size} message(s).${note}`);
    },
  },
];

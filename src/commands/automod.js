const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { normalize, getWords, setWords } = require('../automod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Auto-delete bad words and invite links (mods are exempt)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('add-word').setDescription('Block a word or phrase (use * as a wildcard, e.g. bad*)')
        .addStringOption((o) => o.setName('word').setDescription('Word to block').setRequired(true).setMaxLength(50)),
    )
    .addSubcommand((s) =>
      s.setName('remove-word').setDescription('Unblock a word')
        .addStringOption((o) => o.setName('word').setDescription('Word to unblock').setRequired(true).setMaxLength(50)),
    )
    .addSubcommand((s) =>
      s.setName('invite-filter').setDescription('Block invite links to other servers')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the invite filter on or off').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show blocked words and the invite filter setting')),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const words = getWords(guildId);

    switch (interaction.options.getSubcommand()) {
      case 'add-word': {
        const word = normalize(interaction.options.getString('word').trim());
        // A "word" with no letters (like "*") would block every message
        if (!/[\p{L}\p{N}]/u.test(word)) return reply('❌ The word needs at least one letter or number.');
        if (words.includes(word)) return reply(`ℹ️ ||${word}|| is already blocked.`);
        if (words.length >= 200) return reply('❌ You can block up to 200 words.');
        setWords(guildId, [...words, word]);
        return reply(`✅ Blocked ||${word}||. Messages containing it will be deleted (mods are exempt).`);
      }

      case 'remove-word': {
        const word = normalize(interaction.options.getString('word').trim());
        if (!words.includes(word)) return reply(`❌ ||${word}|| isn't on the list. See \`/automod status\`.`);
        setWords(guildId, words.filter((w) => w !== word));
        return reply(`✅ Unblocked ||${word}||.`);
      }

      case 'invite-filter': {
        const enabled = interaction.options.getBoolean('enabled');
        setSetting(guildId, 'automod_invites', enabled ? '1' : null);
        return reply(enabled ? '✅ Invite links to other servers will be deleted (invites to this server are allowed).' : '✅ Invite filter is off.');
      }

      case 'status':
        return reply([
          `**Invite filter:** ${getSetting(guildId, 'automod_invites') ? 'on' : 'off'}`,
          `**Blocked words (${words.length}):** ${words.map((w) => `||${w}||`).join(', ') || 'none'}`,
          'Moderators (Manage Messages permission) are exempt. Blocked messages are logged in `automod_logger`.',
        ].join('\n'));
    }
  },
};

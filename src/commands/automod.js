const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { normalize, getWords, setWords, automodEnabled } = require('../automod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Auto-delete bad words and invite links (mods are exempt)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('enable').setDescription('Turn auto-mod on for this server'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn auto-mod off (your word list and settings are kept)'))
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
    const offNote = automodEnabled(guildId) ? '' : '\nℹ️ Auto-mod is off right now. Turn it on with `/automod enable`.';

    switch (interaction.options.getSubcommand()) {
      case 'enable':
      case 'disable': {
        const enable = interaction.options.getSubcommand() === 'enable';
        setSetting(guildId, 'automod_enabled', enable ? '1' : null);
        return reply(enable
          ? `✅ Auto-mod is on. It filters blocked words${getSetting(guildId, 'automod_invites') ? ' and invite links' : ''}. See \`/automod status\`.`
          : '✅ Auto-mod is off. No messages will be filtered. Your settings are kept.');
      }

      case 'add-word': {
        const word = normalize(interaction.options.getString('word').trim());
        // A "word" with no letters (like "*") would block every message
        if (!/[\p{L}\p{N}]/u.test(word)) return reply('❌ The word needs at least one letter or number.');
        if (words.includes(word)) return reply(`ℹ️ ||${word}|| is already blocked.`);
        if (words.length >= 200) return reply('❌ You can block up to 200 words.');
        setWords(guildId, [...words, word]);
        return reply(`✅ Blocked ||${word}||. Messages containing it will be deleted (mods are exempt).${offNote}`);
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
        return reply(enabled ? `✅ Invite links to other servers will be deleted (invites to this server are allowed).${offNote}` : '✅ Invite filter is off.');
      }

      case 'status':
        return reply([
          `**Auto-mod:** ${automodEnabled(guildId) ? 'on' : 'off (turn on with `/automod enable`)'}`,
          `**Invite filter:** ${getSetting(guildId, 'automod_invites') ? 'on' : 'off'}`,
          `**Blocked words (${words.length}):** ${words.map((w) => `||${w}||`).join(', ') || 'none'}`,
          'Moderators (Manage Messages permission) are exempt. Blocked messages are logged in `automod_logger`.',
        ].join('\n'));
    }
  },
};

const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db, setSetting } = require('../db');
const { levelInfo, levelingEnabled } = require('../leveling');

const OFF_MESSAGE = { content: 'Leveling is turned off on this server. An admin can turn it on with `/level enable`.', flags: MessageFlags.Ephemeral };

const progressBar = (xp, needed) => {
  const filled = Math.round((xp / needed) * 12);
  return '▰'.repeat(filled) + '▱'.repeat(12 - filled);
};

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Show your level and XP (or someone else\'s)')
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => o.setName('user').setDescription('Whose rank to show')),
    async execute(interaction) {
      if (!levelingEnabled(interaction.guildId)) return interaction.reply(OFF_MESSAGE);
      const user = interaction.options.getUser('user') ?? interaction.user;
      const row = db.prepare('SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, user.id);
      if (!row) return interaction.reply({ content: `**${user.username}** has no XP yet. Chat to earn some!`, allowedMentions: { parse: [] } });

      const { level, xp, needed } = levelInfo(row.xp);
      const { higher } = db.prepare('SELECT COUNT(*) AS higher FROM levels WHERE guild_id = ? AND xp > ?').get(interaction.guildId, row.xp);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .addFields(
          { name: 'Rank', value: `#${higher + 1}`, inline: true },
          { name: 'Level', value: `${level}`, inline: true },
          { name: 'Total XP', value: `${row.xp}`, inline: true },
          { name: `Progress to level ${level + 1}`, value: `${progressBar(xp, needed)}  ${xp} / ${needed} XP` },
        );
      return interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Top 10 most active members')
      .setContexts(InteractionContextType.Guild),
    async execute(interaction) {
      if (!levelingEnabled(interaction.guildId)) return interaction.reply(OFF_MESSAGE);
      const rows = db.prepare('SELECT user_id, xp FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 10').all(interaction.guildId);
      if (!rows.length) return interaction.reply('Nobody has XP yet. Start chatting!');
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.user_id}>: Level ${levelInfo(r.xp).level} (${r.xp} XP)`);
      const embed = new EmbedBuilder()
        .setColor(0xf0b232)
        .setTitle(`🏆 ${interaction.guild.name} leaderboard`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] }); // mentions inside embeds never ping
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Turn the leveling/XP system on or off for this server')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => s.setName('enable').setDescription('Members earn XP, level-up messages are sent'))
      .addSubcommand((s) => s.setName('disable').setDescription('No XP and no level-up messages (existing XP is kept)')),
    async execute(interaction) {
      const enable = interaction.options.getSubcommand() === 'enable';
      setSetting(interaction.guildId, 'leveling_enabled', enable ? '1' : null);
      return interaction.reply({
        content: enable ? '✅ Leveling is on. Members earn XP by chatting.' : '✅ Leveling is off. Existing XP is kept if you turn it back on.',
        flags: MessageFlags.Ephemeral,
      });
    },
  },
];

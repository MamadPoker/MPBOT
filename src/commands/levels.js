const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { db } = require('../db');
const { levelInfo } = require('../leveling');

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
];
